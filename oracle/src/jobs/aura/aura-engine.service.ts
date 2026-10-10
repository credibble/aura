import { keccak256, toBytes } from "viem";
import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SourceFetcher } from "../../ingestion/source-fetcher.service";
import { SourceCacheService } from "../source-cache/source-cache.service";
import { ChainGateway } from "../chain/chain-gateway.service";
import { WsBroadcastService } from "../ws/ws-broadcast.service";
import { KimiAiModel, type SourceGroup, type PreviousTick } from "../../adapters/ai/llm/kimi-ai.model";
import { padToN, clampInt } from "../utils";
import { MIN_AURA_PERCENT, MAX_AURA_PERCENT } from "./aura-band";
import { TIME_SERIES_STORE, AI_MODEL, SOURCE_REGISTRY } from "../../core/ports/tokens";
import type { ITimeSeriesStore } from "../../core/ports/time-series-store";
import type { SourceRegistry } from "../../core/ports/source-registry";
import type { AuraHandle } from "../jobs.types";
import type { Source, SourceConfig } from "../../core/domain/source";
import type { RawDatum } from "../../core/domain/source-item";

const AURA_FETCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Only items NEWER than this reach the AI (when the item carries a time). */
const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Redis TTL for the "already sent to the AI" set (matches the fresh window). */
const SENT_TTL_SECONDS = 24 * 60 * 60;
const AURA_SERIES = "aura:";
/** Evidence scaling floor/ceiling — see `evidenceWeight`. */
const MIN_EVIDENCE_WEIGHT = 0.25;
const REFERENCE_WEIGHTED_ITEMS = 4;

/**
 * ── Bounded, mean-reverting level ────────────────────────────────────────────
 *
 * The aura is modelled as `level L = baseline B + deviation D` instead of a
 * single accumulating number. `B` is the handle's slow "regime" level and `D`
 * is bounded sentiment around it, so a run of directional ticks can never
 * ratchet the index into a wall:
 *
 *  - the AI's percent enters the DEVIATION update (as a level-proportional
 *    kick), never the level directly — `L` is only ever reconstructed as `B + D`.
 *    A purely multiplicative `D ← D·(1 + p/100)` is absorbed at `D = 0`, which
 *    is exactly where a fresh handle starts, so the kick is scaled by the level
 *    instead; that is what keeps `D = 0` non-absorbing.
 *  - every tick reverts a fixed fraction of `D` toward zero, so a shock fades
 *    within a few market windows instead of compounding;
 *  - `B` is a slow EMA of `L`, itself pulled toward a per-handle center seeded
 *    from the handle's first observed aura. The center is what makes the fix
 *    work under a *biased* model: with no anchor, `B` integrates the mean of
 *    `D` (≈ eta·D* per tick) and re-saturates within a week; with it, `B`'s
 *    offset is bounded (`≈ eta/anchor · D`).
 *
 * At the 10-minute AI-tick cadence the constants give a ~45-min deviation
 * half-life and a ~17 h baseline time constant.
 */

/** On-chain ceiling (1e2 — `Handle.MAX_AURA`, 100.00 display). */
const AURA_MAX = 10_000;
/** Half-width of the deviation band (1e2): ±25.00 display points. Wide enough
 *  for sentiment swings to move the index, small enough that the level cannot
 *  accumulate into (or pin against) the ceiling. */
export const AURA_DEVIATION_MAX = 2_500;
/**
 * Fraction of the deviation reverted per tick (0.20 at the 10-min cadence →
 * ~45-min half-life). A single shock fades within a few windows, so the index
 * stays responsive instead of trending; large enough that a persistent positive
 * AI bias cannot outrun the reversion.
 */
export const AURA_REVERSION = 0.2;
/** Baseline EMA rate `eta` toward the level: 0.01/tick ≈ 100 ticks ≈ 16.7 h at
 *  the 10-min cadence — the 12–24 h "slow regime" the design calls for. */
export const AURA_BASELINE_ETA = 0.01;
/**
 * Baseline pull toward its per-handle center. Deliberately a little faster than
 * `eta`, so under a biased AI the baseline settles at a bounded offset
 * (`≈ eta/anchor · D`, ≤ ~half the band) rather than drifting. This is the
 * constant that stops the *baseline* from being the next ratchet.
 */
export const AURA_BASELINE_ANCHOR = 0.02;
/** Margin (in half-bands) kept between the anchor and the ceiling, so
 *  `baseline + D` cannot trivially reach `AURA_MAX` even for a handle first
 *  observed near the top. */
const AURA_CENTER_WALL_MARGIN = 2;

/** One source's scored signal for a handle (grouped for the AI). */
export interface AuraSignal {
  sourceId: string;
  label: string;
  weight: number;
  metrics: { name: string; value: number; delta: number }[];
  series: number[];
  items: string[];
  context?: string;
  topic?: string;
  /** Normalized reach: the sum of the items' own engagement counters. */
  engagement?: number;
}

export interface AuraTick {
  handleId: string;
  label: string;
  /** New aura (1e2). */
  aura: number;
  /** Change vs the previous tick. */
  delta: number;
  /** Evidence hash of this tick (`hashTick`) — committed into a resolution. */
  inputsHash: string;
}

/**
 * The aura job engine: for a handle it resolves its on-chain sources, fetches
 * each ONCE through the shared Redis source cache (so no outside API is hit
 * twice within the TTL), assembles N=10 historical points (a brand-new source
 * repeats its first value N times so aura never spikes), asks the AI for the
 * next aura integer, then persists the aura time series, writes the on-chain
 * aura (auraUpdater) and pushes the update over WS.
 */
@Injectable()
export class AuraEngineService {
  private readonly logger = new Logger(AuraEngineService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly fetcher: SourceFetcher,
    private readonly cache: SourceCacheService,
    private readonly chain: ChainGateway,
    private readonly ws: WsBroadcastService,
    @Inject(AI_MODEL) private readonly ai: KimiAiModel,
    @Inject(TIME_SERIES_STORE) private readonly series: ITimeSeriesStore,
    @Inject(SOURCE_REGISTRY) private readonly registry: SourceRegistry,
  ) {}

  private get historyN(): number {
    return this.config.get<number>("AURA_HISTORY_N") ?? 10;
  }

  private get cacheTtlSeconds(): number {
    return this.config.get<number>("SOURCE_CACHE_TTL_SECONDS") ?? 300;
  }

  /** Economic gate — minimum gap between AI scoring calls for one handle
   *  (bursts of items coalesce into the next tick; 0 disables). */
  private get aiMinIntervalMs(): number {
    return this.config.get<number>("AURA_AI_MIN_INTERVAL_MS") ?? 60_000;
  }

  /** Bounded mean-reverting level parameters — see the constants above. */
  private auraLevelParams(): AuraLevelParams {
    return {
      deviationMax: this.config.get<number>("AURA_DEVIATION_MAX") ?? AURA_DEVIATION_MAX,
      reversion: this.config.get<number>("AURA_REVERSION") ?? AURA_REVERSION,
      eta: this.config.get<number>("AURA_BASELINE_ETA") ?? AURA_BASELINE_ETA,
      anchor: this.config.get<number>("AURA_BASELINE_ANCHOR") ?? AURA_BASELINE_ANCHOR,
    };
  }

  /** Collect a handle's signals (source fetch + metrics) — read-only helper for
   *  debugging/tests; no aura write or WS. */
  async signals(handle: AuraHandle, now: number): Promise<AuraSignal[]> {
    return this.collectSignals(handle, now);
  }

  /** Compute + apply one handle's aura tick. Returns null when unusable. */
  async compute(handle: AuraHandle, now: number): Promise<AuraTick | null> {
    const onChain = (await this.chain.onChainAura(handle.contract)) ?? handle.aura;
    const signals = await this.collectSignals(handle, now);

    // Nothing fresh to score (all items aged out / already sent) — skip the AI
    // call entirely: no aura fetch, no write, no WS.
    if (signals.every((s) => s.items.length === 0)) {
      this.logger.debug(`@${handle.label}: no fresh source items — skipping AI`);
      return null;
    }

    // Economic gate: at most ONE AI call per handle per interval — item
    // bursts coalesce instead of one call each (aura ticks still run; they
    // just defer scoring to the next eligible tick).
    const minGap = this.aiMinIntervalMs;
    if (minGap > 0) {
      const lastKey = { namespace: "aura", account: "ai-last", handle: handle.label };
      const lastCall = (await this.cache.get<{ ts: number }>(lastKey))?.ts ?? 0;
      if (lastCall && now - lastCall < minGap) {
        this.logger.debug(
          `@${handle.label}: AI cooldown (${Math.ceil((minGap - (now - lastCall)) / 1000)}s left) — deferring`,
        );
        return null;
      }
      await this.cache.set(lastKey, { ts: now }, Math.ceil(minGap / 1000) + 60);
    }

    // Prior tick context from the POSTGRES aura series (aura + delta) + the
    // last persisted summary — helps the model score continuously.
    const last = await this.series.latest(AURA_SERIES + handle.label, "aura");
    const prevSummary = await this.cache.get<{ summary: string }>(this.summaryKey(handle.label));
    const previous: PreviousTick = {
      aura: last ? last.value / 100 : undefined,
      delta: last?.delta !== undefined ? last.delta / 100 : undefined,
      summary: prevSummary?.summary,
    };

    // ── Bounded mean-reverting level state (L = B + D) ────────────────────────
    // `D` is derived from the on-chain level; only `B` (a slow EMA) and its
    // per-handle center are persisted. The center is seeded ONCE from the
    // handle's first observed aura — not from the current (possibly saturated)
    // level — so a handle pinned at the ceiling recovers to its established
    // regime instead of staying pinned. When no history exists (a brand-new
    // handle) the on-chain level IS its debut baseline.
    const persistedBaseline = await this.series.latest(AURA_SERIES + handle.label, "baseline");
    const persistedCenter = await this.series.latest(AURA_SERIES + handle.label, "baseline_center");
    const levelParams = this.auraLevelParams();
    let baseline: number;
    let center: number;
    if (persistedBaseline) {
      baseline = persistedBaseline.value;
      center = persistedCenter?.value ?? baseline;
    } else {
      const history = await this.series.points(AURA_SERIES + handle.label, "aura");
      const genesis = history.length > 0 ? history[0]!.value : onChain;
      const anchorCeiling = Math.max(0, AURA_MAX - AURA_CENTER_WALL_MARGIN * levelParams.deviationMax);
      center = clampInt(genesis, 0, anchorCeiling);
      baseline = center;
    }

    const scored = await this.ai.scoreWithSummary(
      handle.label,
      signals.map((s): SourceGroup => ({
        label: s.label,
        reliability: s.weight,
        items: s.items,
        metrics: s.metrics,
        context: s.context,
        topic: s.topic,
      })),
      previous,
    );
    // ── The move: AI direction × EVIDENCE-WEIGHTED magnitude ──────────────────
    // The AI gives direction + a magnitude (percent) + the memo. Its magnitude is
    // ADVISORY: `evidenceWeight` scales it by how much real signal actually
    // arrived (weighted item volume × engagement), so a confident-sounding answer
    // off one weak item can't move the index as far as a broad, high-reach story.
    // The APPLIED move is then itself clamped inside [MIN, MAX]: evidence
    // modulates WITHIN the band but can never push the move below the floor or
    // above the ceiling. Both the band and the weight are deterministic — the
    // model never decides size alone.
    const weight = evidenceWeight(signals);
    const rawPercent = scored.percent;
    const percent = appliedPercent(rawPercent, weight);

    // ONE SERIES: the ON-CHAIN level is the only base. Anchoring on the private
    // Postgres series (when it had drifted from the chain) is exactly what let a
    // resolution settle against a value no participant could see on-chain. A
    // third party reproduces the tick from `Handle.aura` + `AuraHistory`.
    //
    // The move is bounded and mean-reverting: the AI's percent nudges the
    // deviation `D = L − B`, which reverts each tick, and `B` follows the level
    // slowly. See `applyAuraLevel`.
    const update = applyAuraLevel(onChain, percent, { baseline, center }, levelParams);
    const next = update.level;
    const delta = update.delta;

    // ── Audit trail ─────────────────────────────────────────────────────────
    // A tick moves a market price, so what it saw and what the model said must be
    // reconstructable later: one structured line per tick, with an inputsHash over
    // the evidence and the raw reply. The same hash is written into the aura
    // series AND committed on-chain into a resolution receipt.
    const inputsHash = hashTick({
      handleId: handle.id,
      ts: now,
      base: onChain,
      itemIds: signals.flatMap((s) => s.items.slice(0, 8)),
      rawReply: scored.percent,
      percent,
    });
    this.logger.log(
      `@${handle.label}: ${delta >= 0 ? "+" : ""}${delta} → ${(next / 100).toFixed(2)} ` +
        `(ai ${rawPercent}% × evidence ${weight.toFixed(2)} = ${percent}%) ` +
        `sources=${signals.length} items=${signals.reduce((n, s) => n + s.items.length, 0)} hash=${inputsHash.slice(0, 10)}`,
    );

    // The memo written on-chain (`Handle.updateAura`'s summary) and pushed to the
    // chart: the AI's own words, or a compact factual line if it returned none —
    // an empty memo would leave the tick unexplained everywhere downstream.
    const memo =
      scored.summary ||
      `${percent > 0 ? "+" : ""}${percent}% on @${handle.label}${
        signals.length ? ` (${signals.length} source${signals.length === 1 ? "" : "s"})` : ""
      }`;
    const summary = memo.replace(/\s+/g, " ").trim().slice(0, 120);

    // Write EVERY tick on-chain — even when `next === onChain` — so the on-chain
    // `AuraHistory` and the oracle's series are the same sequence. A tick a
    // participant cannot observe on-chain must not exist privately: if the write
    // fails, drop the tick (no series point, no early settle) rather than let the
    // private series drift ahead of the chain.
    const ok = await this.chain.updateAura(handle.contract, next, summary);
    if (!ok) {
      this.logger.warn(
        `@${handle.label}: on-chain aura write failed (${onChain} → ${next}) — tick dropped (no series point)`,
      );
      return null;
    }
    if (next === onChain) {
      // Deliberately NOT a no-op: the on-chain history now carries this point,
      // which is what makes the two series (chain + oracle) identical.
      this.logger.debug(
        `@${handle.label}: aura unchanged at ${(next / 100).toFixed(2)} — still recorded on-chain`,
      );
    }

    // Absolute aura points on the 1e2 scale — the window engine reads the
    // open/close levels off this series (binary: rise vs fall), and commits the
    // closing point's `inputsHash` into the resolution receipt.
    await this.series.append(`aura:${handle.label}`, "aura", {
      timestamp: now,
      value: next,
      delta,
      inputsHash,
    });
    // Persist the engine's bounded-level state alongside the aura series. The
    // `aura` metric above remains the exact chain mirror; these are engine state
    // (a `baseline` row per tick, the constant `baseline_center` only at seed).
    await this.series.append(AURA_SERIES + handle.label, "baseline", {
      timestamp: now,
      value: update.baseline,
    });
    if (!persistedBaseline) {
      await this.series.append(AURA_SERIES + handle.label, "baseline_center", {
        timestamp: now,
        value: center,
      });
    }

    this.ws.publishAura({ handleId: handle.id, aura: next, delta, summary, inputsHash, ts: now });
    // Persist the summary so the NEXT tick can pass it as prior-tick context.
    await this.cache.set(this.summaryKey(handle.label), { summary: scored.summary }, SENT_TTL_SECONDS);
    // No backend aura history: the indexer's aura records are the single
    // source of truth for a handle's aura series + summaries.
    return { handleId: handle.id, label: handle.label, aura: next, delta, inputsHash };
  }

  private summaryKey(label: string): { namespace: string; account: string; handle: string } {
    return { namespace: "aura", account: "last", handle: label };
  }

  /** Per-source signals, each padded to N — the AI's "new data" view. */
  private async collectSignals(handle: AuraHandle, now: number): Promise<AuraSignal[]> {
    // Registry-resolved: on-chain adapter configs + the static feeds for the
    // handle's category. Reading `handle.sources` alone left a seeded handle with
    // no sources at all, so its aura never moved.
    const sources = await this.registry.sourcesForHandle(handle);
    const out: AuraSignal[] = [];
    for (const source of sources) {
      out.push(await this.signalFor(source, handle, now));
    }
    return out;
  }

  private async signalFor(source: Source, handle: AuraHandle, now: number): Promise<AuraSignal> {
    const key = {
      namespace: source.adapter?.platform ?? source.id,
      account: (source.adapter?.account as string | undefined) ?? "default",
      handle: handle.label,
    };
    // Shared Redis source cache — aura + feed + API never re-fetch the same
    // platform within the TTL. `fetch` appends to the metric time series only
    // when it actually hits the platform (cache miss).
    const items = await this.cache.wrap(key, this.cacheTtlSeconds, () =>
      this.fetcher.fetch(source, now - AURA_FETCH_WINDOW_MS, 20),
    );
    // Only NEW (not-yet-scored) items within the last 24h reach the AI —
    // Redis tracks the sent ids with a TTL so the same item never scores twice.
    const fresh = await this.freshItems(source, handle, items, now);

    const metrics: { name: string; value: number; delta: number }[] = [];
    let primary: number[] = [];
    for (const metric of source.metrics ?? []) {
      const points = await this.series.points(source.id, metric.key, now - 48 * 60 * 60 * 1000, now);
      if (points.length === 0) continue;
      const last = points[points.length - 1];
      if (!last) continue;
      metrics.push({ name: metric.key, value: last.value, delta: last.delta ?? 0 });
      primary = padToN(points.map((p) => p.value), this.historyN);
    }

    // NORMALIZED VIEW: whatever the adapter declares, every source also reports
    // the same two numbers — how much arrived (volume) and how much reach it had
    // (engagement, summed from the items' own stats). Without this the AI's
    // numeric picture isn't comparable across source types: an RSS feed shows an
    // item count, X shows likes, Reddit shows upvotes.
    const engagement = items.reduce((sum, d) => sum + (d.engagement ?? 0), 0);
    metrics.push({ name: "volume", value: items.length, delta: fresh.length });
    if (engagement > 0) metrics.push({ name: "engagement", value: engagement, delta: engagement });

    // Transport sources (rss/gdelt/...) contribute an item-count series.
    if (primary.length === 0) {
      primary = padToN(Array.from({ length: items.length }, (_, i) => items.length - i), this.historyN);
    }

    return {
      sourceId: source.id,
      label: source.label,
      weight: source.weight,
      metrics,
      engagement,
      series: primary,
      // The actual item texts — this is the SENTIMENT the AI scores on. Only
      // fresh (<24h, not already scored) items; deduped via Redis. Economic
      // caps: 8 items x 240 chars per source is plenty of sentiment signal.
      //
      // Each line carries the endpoint's own engagement when it has one, so the
      // model can weigh reach ("88K views · 12.4K likes") against the words.
      items: fresh
        .slice(0, 8)
        .map((d) => {
          const text = d.text.length > 240 ? d.text.slice(0, 240) : d.text;
          const stats = countLine(d.stats);
          const who = d.author ? ` by ${d.author}` : "";
          return `${text}${who}${stats ? ` [${stats}]` : ""}`;
        }),
      // The on-chain source JSON carries the handle-specific frame: what the
      // outlet is and how to read it for THIS handle (topic + context). Fall back
      // to the raw adapter config for configs built before toSource copied them.
      context: source.context ?? (source.adapter ? this.strConfig(source.adapter, "context") : undefined),
      topic: source.topic ?? (source.adapter ? this.strConfig(source.adapter, "topic") : undefined),
    };
  }

  /** Redis-backed dedupe: age-filter to <24h (when the item has a time) and drop
   *  items already sent to the AI (sent-set keyed per source+handle, TTL 24h). */
  private async freshItems(source: Source, handle: AuraHandle, items: RawDatum[], now: number): Promise<RawDatum[]> {
    const aged = items.filter((d) => !d.publishedAt || d.publishedAt >= now - FRESH_WINDOW_MS);
    const sentKey = { namespace: source.id, account: "sent", handle: handle.label };
    const sent = (await this.cache.get<{ ids: string[] }>(sentKey))?.ids ?? [];
    const fresh = aged.filter((d) => d.id && !sent.includes(d.id));
    if (fresh.length > 0) {
      const merged = [...new Set([...sent, ...fresh.map((d) => d.id)])].slice(-500);
      await this.cache.set(sentKey, { ids: merged }, SENT_TTL_SECONDS);
    }
    return fresh;
  }

  private strConfig(config: SourceConfig, key: string): string | undefined {
    const v = config[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  }
}

/**
 * "12.4K likes · 340 replies · 88K views" — the engagement the source endpoint
 * returned, rendered as one line for the AI prompt (and the feed card).
 */
export function countLine(stats: Record<string, number> | undefined): string {
  if (!stats) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(stats)) {
    if (!Number.isFinite(value) || value <= 0) continue;
    const label =
      key === "score"
        ? "upvotes"
        : key === "upvoteRatio"
          ? "% upvoted"
          : key.replace(/([A-Z])/g, " $1").toLowerCase();
    parts.push(`${formatCount(value)}${label === "% upvoted" ? "" : " "}${label}`);
  }
  return parts.slice(0, 4).join(" · ");
}

/**
 * How much the evidence justifies a move, in [0.25, 1]. Deterministic — the same
 * inputs always scale the AI's magnitude the same way.
 *
 *  - credibility-weighted item volume: a BBC article (weight 1000) counts ~3× an
 *    anonymous community post (weight 300);
 *  - a mild engagement bonus for reach (log-scaled, capped), so a story everyone
 *    is talking about moves further than one nobody read.
 *
 * A single weak item lands near the 0.25 floor, a broad high-reach story at 1.0.
 * The point is that "the model sounded confident" is never enough on its own.
 */
export function evidenceWeight(
  signals: { weight: number; items: string[]; engagement?: number }[],
): number {
  if (signals.length === 0) return MIN_EVIDENCE_WEIGHT;
  let weightedItems = 0;
  let engagement = 0;
  for (const s of signals) {
    const credibility = Math.max(0.2, Math.min(1, (s.weight ?? 0) / 1000));
    weightedItems += credibility * Math.min(s.items.length, 8);
    engagement += s.engagement ?? 0;
  }
  // 4 weighted items ≈ full strength; engagement adds at most +25%.
  const volume = Math.min(1, weightedItems / REFERENCE_WEIGHTED_ITEMS);
  const reach = Math.min(0.25, Math.log10(1 + engagement) / 28);
  return Math.max(MIN_EVIDENCE_WEIGHT, Math.min(1, volume + reach));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The tick's applied percent: the AI's direction, its magnitude scaled by
 * evidence, then re-clamped so the MOVE ITSELF sits inside [MIN_AURA_PERCENT,
 * MAX_AURA_PERCENT]. Evidence modulates WITHIN the band — a weak read moves the
 * floor, a broad high-reach story up to the ceiling — but can never push the
 * move below the floor or above the ceiling.
 */
export function appliedPercent(rawPercent: number, weight: number): number {
  const direction = rawPercent < 0 ? -1 : 1;
  const aiMagnitude = Math.min(MAX_AURA_PERCENT, Math.max(MIN_AURA_PERCENT, Math.abs(rawPercent)));
  const scaled = aiMagnitude * weight;
  const magnitude = Math.min(MAX_AURA_PERCENT, Math.max(MIN_AURA_PERCENT, scaled));
  return round1(direction * magnitude);
}

/** Tuning knobs for {@link applyAuraLevel} (all overridable via env). */
export interface AuraLevelParams {
  /** Deviation half-width (1e2). */
  deviationMax: number;
  /** Fraction of the deviation reverted per tick. */
  reversion: number;
  /** Baseline EMA rate toward the level. */
  eta: number;
  /** Baseline pull toward its center. */
  anchor: number;
}

export const DEFAULT_AURA_LEVEL_PARAMS: AuraLevelParams = {
  deviationMax: AURA_DEVIATION_MAX,
  reversion: AURA_REVERSION,
  eta: AURA_BASELINE_ETA,
  anchor: AURA_BASELINE_ANCHOR,
};

/** The two pieces of persisted engine state the level update needs (1e2). */
export interface AuraLevelState {
  /** Slow EMA baseline of the level. */
  baseline: number;
  /** Fixed per-handle anchor the baseline reverts to. */
  center: number;
}

/** A tick's resulting level, next baseline, and the signed change. */
export interface AuraLevelUpdate {
  level: number;
  baseline: number;
  delta: number;
}

/**
 * One bounded, mean-reverting aura step (`L' = B + D'`). Pure and deterministic
 * so a tick can be replayed and the week-long simulation can share the exact
 * code path the engine runs.
 *
 *     D  = clamp(L − B, ±D_MAX)
 *     D' = clamp((D + L·p/100)·(1 − reversion), ±D_MAX)
 *     L' = clamp(B + D', 0, AURA_MAX)
 *     B' = clamp(B + eta·(L' − B) + anchor·(center − B), 0, AURA_MAX)
 *
 * The AI's percent is applied to the CURRENT LEVEL and only ever lands in `D`.
 * Scaling the kick by `L` (rather than by `D`) is load-bearing: a purely
 * multiplicative update on `D` is absorbed at `D = 0` (0 × anything stays 0) and
 * the index would freeze on its first tick.
 */
export function applyAuraLevel(
  level: number,
  percent: number,
  state: AuraLevelState,
  params: AuraLevelParams = DEFAULT_AURA_LEVEL_PARAMS,
): AuraLevelUpdate {
  const deviation = clampInt(level - state.baseline, -params.deviationMax, params.deviationMax);
  const kicked = deviation + (level * percent) / 100;
  const nextDeviation = clampInt(
    kicked * (1 - params.reversion),
    -params.deviationMax,
    params.deviationMax,
  );
  let next = clampInt(state.baseline + nextDeviation, 0, AURA_MAX);
  // Display-rounding guard only (NOT a growth engine): at the 1e2 scale a small
  // percent can round to zero, so a tick still moves one unit — otherwise
  // "never a dead tick" fails and a window can open and close unchanged.
  if (next === level) next = clampInt(level + (percent < 0 ? -1 : 1), 0, AURA_MAX);

  const baseline = clampInt(
    state.baseline + params.eta * (next - state.baseline) + params.anchor * (state.center - state.baseline),
    0,
    AURA_MAX,
  );
  return { level: next, baseline, delta: next - level };
}

/**
 * keccak256 over the tick's evidence + the model's raw answer. Deterministic and
 * cheap; the audit log and the WS push carry it, so a tick can be replayed and a
 * resolution receipt can commit to it later.
 */
export function hashTick(input: {
  handleId: string;
  ts: number;
  base: number;
  itemIds: string[];
  rawReply: number;
  percent: number;
}): string {
  return keccak256(
    toBytes(
      [
        input.handleId,
        String(input.ts),
        String(input.base),
        String(input.rawReply),
        String(input.percent),
        input.itemIds.join("|"),
      ].join("\n"),
    ),
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}