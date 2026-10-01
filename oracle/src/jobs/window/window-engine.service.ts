import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { keccak256, toBytes } from "viem";
import { REDIS } from "../../queue/queue.constants";
import { slotBounds } from "@aura/contracts";
import { ChainGateway } from "../chain/chain-gateway.service";
import { IndexerReader, type IndexerWindow } from "../indexer/indexer-reader.service";
import { WsBroadcastService } from "../ws/ws-broadcast.service";
import { TIME_SERIES_STORE } from "../../core/ports/tokens";
import type { ITimeSeriesStore } from "../../core/ports/time-series-store";
import {
  marketStyle,
  windowMetadata,
  gainBetween,
} from "./market-style";
import type { AuraHandle } from "../jobs.types";
import { strikeFor, windowPriors, stepSeconds } from "./window-pricing";

const FREEZE_SECONDS = 5;
/** Minimum window funding: 1,000 USDC (1e18 wei). */
const MIN_FUNDING = 1_000n * 10n ** 18n;
/** The pricing model's lookback for drift/volatility: the last 24h of ticks. */
const PRIOR_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * The market-maker window job engine — one tick per (handle, slot):
 *  - the tick RUNS AS EACH SLOT BEGINS (the queue keys the job by slot), so it
 *    first RETIRES the slot that just closed, then opens the new one;
 *  - SETTLE: every recent slot whose oracle exists and is no longer open is
 *    resolved + settled. The winner comes from the aura series — binary: YES (0)
 *    wins iff the aura close ≥ the window's STRIKE (the level at open); the
 *    strike comes from the indexer record, or is reconstructed exactly as at
 *    open. Multi-outcome: the member that gained the most aura (close − open);
 *  - OPEN: the current slot's window, only when the handle has NO live window.
 *
 * ALL of that is decided from the CHAIN (`OracleFactory.oracleOf` +
 * `MarketMaker.isOpen`). The indexer lags — and can wedge — and depending on it
 * meant a stale "still open" window blocked the next open and hid the window
 * that needed settling. It is now only consulted to enrich a settle (outcome
 * labels) and to size funding. Redis flags keep every action idempotent across
 * restarts/re-deploys, and short-circuit settled slots without any RPC.
 */
@Injectable()
export class WindowEngineService {
  private readonly logger = new Logger(WindowEngineService.name);
  /**
   * How many PAST slots to re-check on-chain for a window that needs settling.
   * Small on purpose: each slot costs two RPC reads, and the public endpoint
   * rejects bursts — `RPC_MAX_RPS` throttles the rest.
   */
  private static readonly SETTLE_LOOKBACK_SLOTS = 3;

  constructor(
    private readonly chain: ChainGateway,
    private readonly indexer: IndexerReader,
    private readonly ws: WsBroadcastService,
    @Inject(TIME_SERIES_STORE) private readonly series: ITimeSeriesStore,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  /** How often the aura engine is allowed to tick one handle (ms). A window must
   *  be at least this long, or it can open and close between two observations. */
  private get auraCadenceMs(): number {
    return this.config.get<number>("AURA_AI_MIN_INTERVAL_MS") ?? 0;
  }

  private openKey(handleId: string, startSec: number): string {
    return `win:open:${handleId}:${startSec}`;
  }

  private settledKey(handleId: string, startSec: number): string {
    return `win:settled:${handleId}:${startSec}`;
  }

  async tick(handle: AuraHandle, now: number): Promise<void> {
    const started = Date.now();
    try {
      if (!handle.graduated) return;
      // No signer/RPC: nothing can be opened, and retrying forever would spin
      // the queue. Treat as "nothing to do".
      if (!this.chain.ready) return;

      // EVERY decision below comes from the CHAIN, never the indexer: a stale
      // "still open" window used to block the next open while hiding the window
      // that needed settling. The indexer only labels outcomes + sizes funding.
      const slots = this.recentSlots(handle, now);
      const known = await this.indexer.openWindows().catch((): IndexerWindow[] => []);
      const nowSec = Math.floor(now / 1000);
      let live = false;

      for (const slot of slots) {
        // A slot already settled needs no RPC at all.
        if (await this.flag(this.settledKey(handle.id, slot.start))) continue;

        const oracle = await this.chain.oracleOf(handle.label, slot.start);
        // null = the RPC couldn't answer. That is NOT "no oracle" — propagating
        // lets the queue retry the slot instead of opening a duplicate window.
        if (oracle === null) throw new Error(`oracleOf unknown for @${handle.label} (slot retry)`);
        if (oracle === "0x0000000000000000000000000000000000000000") continue; // never opened

        const open = await this.chain.isOpen(oracle);
        if (open === null) throw new Error(`isOpen unknown for @${handle.label} (slot retry)`);

        if (open) {
          live = true; // one live window per handle — never open a second
          if (slot.end <= nowSec) {
            this.logger.debug(
              `@${handle.id}: window ${slot.start} still open past its end — waiting for the freeze`,
            );
          }
          continue;
        }
        await this.settleWindow(handle, oracle, slot, known, nowSec);
      }

      // SUPPLEMENT: windows that are NOT on the slot grid — the deploy/seed
      // script opens at "now", not at a slot boundary, so `oracleOf` can never
      // find them. The indexer lists them (unsettled only); the CHAIN still
      // decides whether they are closed, so a stale list can't block anything.
      for (const w of known) {
        if (w.handleId.toLowerCase() !== handle.id.toLowerCase()) continue;
        if (await this.flag(this.settledKey(handle.id, w.windowStart))) continue;
        if (w.windowEnd + FREEZE_SECONDS >= nowSec) {
          live = true; // a seeded window still trading: never open a second one
          continue;
        }
        const open = await this.chain.isOpen(w.oracle);
        if (open === null) throw new Error(`isOpen unknown for ${w.oracle} (slot retry)`);
        if (open) {
          live = true;
          continue;
        }
        await this.settleWindow(
          handle,
          w.oracle,
          { start: w.windowStart, end: w.windowEnd },
          known,
          nowSec,
        );
      }

      if (live) {
        // Keep the current slot flagged so a racing tick cannot double-open.
        await this.setFlag(this.openKey(handle.id, slots[0]!.start));
      } else {
        await this.openSlot(handle, slots[0]!, now);
      }
      this.logger.debug(`@${handle.id}: slot tick done in ${Date.now() - started}ms`);
    } catch (error) {
      // Without this a stuck/failed tick is invisible: the queue just holds the
      // job and no window is ever opened or settled.
      this.logger.warn(
        `@${handle.id}: slot tick failed after ${Date.now() - started}ms — ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /** The current slot plus the past slots still worth checking, newest first. */
  private recentSlots(handle: AuraHandle, now: number): { start: number; end: number }[] {
    const spanMs = handle.windowMinutes * 60_000;
    const out: { start: number; end: number }[] = [];
    for (let i = 0; i <= WindowEngineService.SETTLE_LOOKBACK_SLOTS; i++) {
      const { start, end } = slotBounds(now - i * spanMs, handle.windowMinutes);
      out.push({ start: Math.floor(start / 1000), end: Math.floor(end / 1000) });
    }
    return out;
  }

  /** Open the current slot's window (the caller already proved none is live). */
  private async openSlot(
    handle: AuraHandle,
    slot: { start: number; end: number },
    now: number,
  ): Promise<void> {
    const startSec = slot.start;
    const endSec = slot.end;
    // A slot whose end has already passed can never be opened (the market
    // refuses a window closing in the past) — retrying it would pin this slot's
    // job forever, so treat it as done.
    if (endSec <= Math.floor(now / 1000)) return;
    if (await this.flag(this.openKey(handle.id, startSec))) return;

    // TIMING SANITY: a window shorter than the aura cadence can open and close
    // between two observations, which is exactly the "no information" case the
    // settle path now voids. Worth a loud line so the config gets fixed.
    const windowMs = (endSec - startSec) * 1000;
    if (this.auraCadenceMs > 0 && windowMs < this.auraCadenceMs) {
      this.logger.warn(
        `@${handle.id}: ${endSec - startSec}s window is shorter than the ${Math.round(
          this.auraCadenceMs / 60_000,
        )}m aura cadence — short enable will produce no-observation (void) windows`,
      );
    }

    // The handle's primary category is carried into the window metadata for
    // display; the style itself is always binary.
    const style = marketStyle(handle.categories[0] ?? 0);
    const outcomes: string[] = ["YES", "NO"];

    // STRIKE + INITIAL PROBABILITIES from the handle's own aura series (see
    // window-pricing.ts): the strike is the level at open, and the odds are
    // Φ(risk-adjusted drift · √horizon). A quiet handle falls back to 50/50.
    const history = await this.series.points(
      `aura:${handle.label}`,
      "aura",
      now - PRIOR_LOOKBACK_MS,
      now,
    );
    const series = history.map((p) => p.value);
    const strike = strikeFor(series, handle.aura);
    const priors = windowPriors({
      points: series,
      windowSec: Math.max(1, endSec - startSec),
      stepSec: stepSeconds(history.map((p) => Math.floor(p.timestamp / 1000))) || 0,
    });
    const probabilities: string[] = [...priors.probabilities];
    this.logger.log(
      `@${handle.id}: strike ${(strike / 100).toFixed(2)} · P(YES)=${(priors.model.pYes * 100).toFixed(1)}%` +
        (priors.model.fallback
          ? " (no history — 50/50)"
          : ` (drift ${(priors.model.drift * 100).toFixed(2)}%, vol ${(priors.model.vol * 100).toFixed(2)}%, ${priors.model.steps} step(s))`),
    );
    // The question text carries the same strike the odds were priced off.
    const metadata = windowMetadata(handle.label, style, strike);

    // Funding = the handle's PREVIOUS window trading volume (USDC 1e18),
    // floored at 1k USDC so a fresh/quiet handle still opens liquid.
    const funding = await this.fundingFor(handle, startSec);

    const ok = await this.chain.openWindow(
      handle.label,
      startSec,
      endSec,
      funding,
      outcomes,
      probabilities,
      metadata,
    );
    if (ok) {
      await this.setFlag(this.openKey(handle.id, startSec));
      this.ws.publishWindowOpened(handle.id, startSec, endSec, handle.windowMinutes);
      this.logger.log(
        `@${handle.id}: opened ${style.style} window ${startSec} (${outcomes.join(" / ")})`,
      );
      return;
    }
    // The slot's job id is keyed by slot, so a failed open would never be retried
    // and the handle would sit windowless for the whole slot. Surface it instead.
    throw new Error(`openWindow failed for @${handle.label} (slot retry)`);
  }

  private async settleWindow(
    handle: AuraHandle,
    oracle: string,
    slot: { start: number; end: number },
    known: IndexerWindow[],
    nowSec: number,
  ): Promise<void> {
    if (slot.end + FREEZE_SECONDS >= nowSec) return; // froze moments ago — let it freeze
    const rec = known.find((w) => w.oracle.toLowerCase() === oracle.toLowerCase());
    // Every market is binary: the outcome labels are always YES/NO, so a window
    // whose indexer record hasn't landed can still be settled correctly.
    const outcomes = rec?.outcomes ?? ["YES", "NO"];
    const windowStart = rec?.windowStart ?? slot.start;
    const windowEnd = rec?.windowEnd ?? slot.end;

    // NO OBSERVATIONS → NO RESOLUTION. A window that opened and closed between two
    // aura ticks has no measurement to settle on; settling it would resolve YES on
    // an unchanged series (a systematic bias in quiet periods). Leave it: the
    // market's grace window VOIDs it and `redeemVoid` refunds every trader.
    // The SAME bounds the winner uses (`[windowStart, windowEnd]`) — the guard and
    // the decision must see exactly the same observations.
    const observed = await this.series.points(
      `aura:${handle.label}`,
      "aura",
      windowStart * 1000,
      windowEnd * 1000,
    );
    if (observed.length < 1) {
      this.logger.warn(
        `@${handle.id}: window ${windowStart} has no aura observations — leaving it to VOID`,
      );
      return;
    }

    // The STRIKE the question and Window.strike both carry — the reference the
    // winner is measured against. Prefer the indexer record (it mirrors the
    // on-chain metadata); reconstruct it exactly as openSlot did when the record
    // hasn't landed.
    const reference = await this.referenceFor(handle, rec, windowStart);

    const winner = await this.winnerFromReference(
      handle,
      outcomes,
      windowStart,
      windowEnd,
      reference,
    );
    // The market settles ONLY from an Oracle resolution now, so the receipt is
    // built from the same strike + series the winner came from and submitted first.
    const receipt = await this.windowReceipt(
      handle,
      { windowStart, windowEnd, outcomes },
      winner,
      reference,
    );
    this.logger.log(
      `@${handle.id}: resolving window ${windowStart} → outcome ${winner} (${oracle})`,
    );
    const ok = await this.chain.resolveAndSettle(oracle, receipt, winner);
    if (ok) {
      await this.setFlag(this.settledKey(handle.id, windowStart));
      this.ws.publishWindowResolved(handle.id, windowStart, windowEnd, winner);
      this.logger.log(`@${handle.id}: settled window ${windowStart} → outcome ${winner}`);
    }
  }

  /**
   * The window's STRIKE — the aura level at open that the question text and the
   * indexer's `Window.strike` both carry. The indexer record mirrors the on-chain
   * metadata, so prefer it; when the record hasn't landed, reconstruct it exactly
   * as `openSlot` did: the last series point in the pricing lookback up to open.
   */
  private async referenceFor(
    handle: AuraHandle,
    rec: IndexerWindow | undefined,
    windowStartSec: number,
  ): Promise<number> {
    if (rec && Number.isFinite(rec.strike) && rec.strike > 0) return rec.strike;
    const prior = await this.series.points(
      `aura:${handle.label}`,
      "aura",
      windowStartSec * 1000 - PRIOR_LOOKBACK_MS,
      windowStartSec * 1000,
    );
    return strikeFor(prior.map((p) => p.value), handle.aura);
  }

  /**
   * Binary windows: YES (0) wins iff the aura close ≥ the window's STRIKE (the
   * level at open) — NOT the first in-window observation. The aura only ticks
   * when fresh evidence arrives, so a 60-minute window usually holds 0 or 1
   * observations; with exactly one, `close >= points[0]` was vacuously true and
   * every window resolved YES.
   *
   * An empty series never reaches here — `settleWindow` leaves it to VOID. The
   * fallback to `reference` only keeps this function total.
   */
  private async winnerFromReference(
    handle: AuraHandle,
    outcomes: string[],
    windowStartSec: number,
    closeSec: number,
    reference: number,
  ): Promise<number> {
    if (outcomes.length === 2 && outcomes[0] === "YES" && outcomes[1] === "NO") {
      const points = await this.series.points(
        `aura:${handle.label}`,
        "aura",
        windowStartSec * 1000,
        closeSec * 1000,
      );
      const close = points[points.length - 1]?.value ?? reference;
      return close >= reference ? 0 : 1;
    }
    // Multi-outcome: a GAIN market — the winner is the member handle that
    // gained the most aura (close − open) over the window (each outcome is a
    // member; a 2-member multi window resolves here too, never as YES/NO).
    let best = Number.NEGATIVE_INFINITY;
    let bestIdx = 0;
    for (let i = 0; i < outcomes.length; i++) {
      const label = outcomes[i];
      if (!label) continue;
      const gain = await this.auraGain(label, windowStartSec, closeSec);
      if (gain > best) {
        best = gain;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /**
   * The EIP-712 resolution receipt for a window, derived from the SAME aura
   * series the winner came from (open/close for binary, gains for a gain market).
   * `outcomesHash` commits to the ordered outcome labels so the receipt can never
   * be replayed against a different market shape.
   */
  private async windowReceipt(
    handle: AuraHandle,
    win: { windowStart: number; windowEnd: number; outcomes: string[] },
    winner: number,
    reference: number,
  ): Promise<{
    handleId: string;
    windowStart: number;
    windowEnd: number;
    s: number;
    expectation: number;
    delta: number;
    indexOpen: number;
    indexClose: number;
    direction: boolean;
    itemCount: number;
    outcomesHash: string;
  }> {
    const points = await this.series.points(
      `aura:${handle.label}`,
      "aura",
      win.windowStart * 1000,
      win.windowEnd * 1000,
    );
    // The open reference committed to the receipt MUST be the same strike the
    // winner used — the on-chain Oracle/`MarketMaker.settle` mirrors this receipt.
    const close = points[points.length - 1]?.value ?? reference;
    return {
      handleId: handle.id,
      windowStart: win.windowStart,
      windowEnd: win.windowEnd,
      s: close,
      expectation: reference,
      delta: close - reference,
      indexOpen: reference,
      indexClose: close,
      // The receipt's `direction` is the binary truth (0 = YES wins); the market
      // derives its index from it for 2-outcome windows.
      direction: winner === 0,
      itemCount: points.length,
      outcomesHash: keccak256(
        toBytes(
          win.outcomes.map((o, i) => `${i}:${o}`).join("|") || "aura",
        ),
      ),
    };
  }

  /** A member handle's aura gain (close − open) over [startSec, closeSec]. */
  private async auraGain(
    label: string,
    startSec: number,
    closeSec: number,
  ): Promise<number> {    const points = await this.series.points(
      `aura:${label}`,
      "aura",
      startSec * 1000,
      closeSec * 1000,
    );
    if (points.length === 0) return 0;
    const open = points[0]?.value ?? 0;
    const close = points[points.length - 1]?.value ?? open;
    return gainBetween(open, close);
  }

  private async fundingFor(
    handle: AuraHandle,
    startSec: number,
  ): Promise<string> {
    const prev = await this.indexer.previousSettledWindow(handle.id, startSec);
    let funding = MIN_FUNDING;
    if (prev) {
      const volume = await this.indexer.windowVolume(prev.id);
      if (volume > 0n) {
        // Round up to the next 100 USDC so the window funds cleanly.
        const hundred = 100n * 10n ** 18n;
        const rounded = ((volume + hundred - 1n) / hundred) * hundred;
        funding = rounded > MIN_FUNDING ? rounded : MIN_FUNDING;
      }
    }
    return funding.toString();
  }

  private async flag(key: string): Promise<boolean> {
    try {
      return (await this.redis.get(key)) === "1";
    } catch {
      return false;
    }
  }

  private async setFlag(key: string): Promise<void> {
    try {
      await this.redis.set(key, "1");
    } catch {
      /* redis down — best-effort */
    }
  }
}
