import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdapterRegistry } from "../../adapters/adapter-registry.service";
import { SourceFetcher } from "../../ingestion/source-fetcher.service";
import { SourceCacheService } from "../source-cache/source-cache.service";
import { ChainGateway } from "../chain/chain-gateway.service";
import { WsBroadcastService } from "../ws/ws-broadcast.service";
import { KimiAiModel, type SourceGroup, type PreviousTick } from "../../adapters/ai/llm/kimi-ai.model";
import { padToN, clampInt } from "../utils";
import { TIME_SERIES_STORE, AI_MODEL } from "../../core/ports/tokens";
import type { ITimeSeriesStore } from "../../core/ports/time-series-store";
import type { AuraHandle } from "../jobs.types";
import type { Source, SourceConfig } from "../../core/domain/source";
import type { RawDatum } from "../../core/domain/source-item";

const AURA_FETCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Only items NEWER than this reach the AI (when the item carries a time). */
const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Redis TTL for the "already sent to the AI" set (matches the fresh window). */
const SENT_TTL_SECONDS = 24 * 60 * 60;
const AURA_SERIES = "aura:";

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
}

export interface AuraTick {
  handleId: string;
  label: string;
  /** New aura (1e2). */
  aura: number;
  /** Change vs the previous tick. */
  delta: number;
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
    private readonly adapters: AdapterRegistry,
    private readonly fetcher: SourceFetcher,
    private readonly cache: SourceCacheService,
    private readonly chain: ChainGateway,
    private readonly ws: WsBroadcastService,
    @Inject(AI_MODEL) private readonly ai: KimiAiModel,
    @Inject(TIME_SERIES_STORE) private readonly series: ITimeSeriesStore,
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
    const deltaDisplay = scored.aura;
    // The AI replies in 2dp display aura units — convert to the 1e2 on-chain
    // scale. Every aura tick must move at least ±0.01 (no zero/neutral ticks):
    // a sub-0.01 score snaps to the minimum movement in its sign's direction.
    let delta = Math.round(deltaDisplay * 100);
    if (delta === 0) delta = deltaDisplay >= 0 ? 1 : -1;
    const next = clampInt(onChain + delta, 0, 10_000);

    // Absolute aura points on the 1e2 scale — the window engine reads the
    // open/close levels off this series (binary: rise vs fall; multi-outcome:
    // the member with the highest gain over the window).
    await this.series.append(`aura:${handle.label}`, "aura", {
      timestamp: now,
      value: next,
      delta,
    });

    if (next !== onChain) {
      const ok = await this.chain.updateAura(handle.contract, next, scored.summary);
      if (!ok) {
        this.logger.warn(`@${handle.label}: on-chain aura write failed (${onChain} → ${next})`);
      }
    }

    this.ws.publishAura({ handleId: handle.id, aura: next, delta, ts: now });
    // Persist the summary so the NEXT tick can pass it as prior-tick context.
    await this.cache.set(this.summaryKey(handle.label), { summary: scored.summary }, SENT_TTL_SECONDS);
    // No backend aura history: the subgraph's aura records are the single
    // source of truth for a handle's aura series + summaries.
    return { handleId: handle.id, label: handle.label, aura: next, delta };
  }

  private summaryKey(label: string): { namespace: string; account: string; handle: string } {
    return { namespace: "aura", account: "last", handle: label };
  }

  /** Per-source signals, each padded to N — the AI's "new data" view. */
  private async collectSignals(handle: AuraHandle, now: number): Promise<AuraSignal[]> {
    const sources = this.adapters.buildFromJsonStrings(handle.sources);
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
    // Transport sources (rss/gdelt/...) contribute an item-count signal.
    if (metrics.length === 0 && !source.adapter) {
      primary = padToN(Array.from({ length: items.length }, (_, i) => items.length - i), this.historyN);
      metrics.push({ name: "items", value: items.length, delta: items.length });
    }

    return {
      sourceId: source.id,
      label: source.label,
      weight: source.weight,
      metrics,
      series: primary,
      // The actual item texts — this is the SENTIMENT the AI scores on. Only
      // fresh (<24h, not already scored) items; deduped via Redis. Economic
      // caps: 8 items x 240 chars per source is plenty of sentiment signal.
      items: fresh.slice(0, 8).map((d) => (d.text.length > 240 ? d.text.slice(0, 240) : d.text)),
      context: source.adapter ? this.strConfig(source.adapter, "context") : undefined,
      topic: source.adapter ? this.strConfig(source.adapter, "topic") : undefined,
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