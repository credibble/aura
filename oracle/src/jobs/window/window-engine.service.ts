import { Injectable, Inject, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import { keccak256, toBytes } from "viem";
import { REDIS } from "../../queue/queue.constants";
import { slotBounds } from "@aura/contracts";
import { ChainGateway } from "../chain/chain-gateway.service";
import { SubgraphReader, type SubgraphWindow } from "../subgraph/subgraph-reader.service";
import { WsBroadcastService } from "../ws/ws-broadcast.service";
import { TIME_SERIES_STORE } from "../../core/ports/tokens";
import type { ITimeSeriesStore } from "../../core/ports/time-series-store";
import {
  parseMarketStyle,
  windowMetadata,
  gainBetween,
  CATEGORY_BASE,
} from "./market-style";
import { sampleMembers, priorProbabilities, MAX_OUTCOMES } from "./category-market";
import type { AuraHandle } from "../jobs.types";

const FREEZE_SECONDS = 5;
/** Minimum window funding: 1,000 USDC (1e18 wei). */
const MIN_FUNDING = 1_000n * 10n ** 18n;

/**
 * The market-maker window job engine — one tick per (handle, slot):
 *  - the tick RUNS AS EACH SLOT BEGINS (the queue keys the job by slot), so it
 *    first RETIRES the slot that just closed, then opens the new one;
 *  - SETTLE: every recent slot whose oracle exists and is no longer open is
 *    resolved + settled. The winner comes from the aura series — binary: YES (0)
 *    wins iff the aura close ≥ the aura at open; multi-outcome: the member that
 *    gained the most aura (close − open);
 *  - OPEN: the current slot's window, only when the handle has NO live window.
 *
 * ALL of that is decided from the CHAIN (`OracleFactory.oracleOf` +
 * `MarketMaker.isOpen`). The subgraph lags — and can wedge — and depending on it
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
    private readonly subgraph: SubgraphReader,
    private readonly ws: WsBroadcastService,
    @Inject(TIME_SERIES_STORE) private readonly series: ITimeSeriesStore,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

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
      // that needed settling. The subgraph only labels outcomes + sizes funding.
      const slots = this.recentSlots(handle, now);
      const known = await this.subgraph.openWindows().catch((): SubgraphWindow[] => []);
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

    // The category code dictates the window's market style + question.
    let style = parseMarketStyle(handle.category);
    if (!style) {
      style = {
        category: handle.category,
        cat: CATEGORY_BASE,
        sub: CATEGORY_BASE,
        format: 1,
        style: "binary",
        base: "sport",
        subLabel: "uncategorized",
      };
    }
    let outcomes: string[] = ["YES", "NO"];
    let probabilities: string[] = ["500000000000000000", "500000000000000000"]; // 50/50 binary
    if (style.style === "multi") {
      // Gain market: pick the underlying handles of the category AT
      // RANDOM (capped at MAX_OUTCOMES) and price the open with aura priors.
      const pool = await this.subgraph.handlesByCategory(style.sub);
      const members = sampleMembers(pool, handle.label, MAX_OUTCOMES);
      if (members.length < 2) {
        this.logger.log(
          `@${handle.id}: multi-outcome category ${style.category} has ${members.length} members — skipping open`,
        );
        return;
      }
      outcomes = members.map((m) => m.label);
      probabilities = priorProbabilities(members);
    }
    const metadata = windowMetadata(handle.label, style, handle.aura);

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
    known: SubgraphWindow[],
    nowSec: number,
  ): Promise<void> {
    if (slot.end + FREEZE_SECONDS >= nowSec) return; // froze moments ago — let it freeze
    const rec = known.find((w) => w.oracle.toLowerCase() === oracle.toLowerCase());
    if (!rec && parseMarketStyle(handle.category)?.style === "multi") {
      // A grouped window's winner is an INDEX into its outcome list; guessing the
      // order would settle the wrong handle. Wait for the labels instead.
      this.logger.warn(
        `@${handle.id}: grouped window ${oracle} is closed but its outcome labels aren't indexed yet — will retry`,
      );
      return;
    }
    const outcomes = rec?.outcomes ?? ["YES", "NO"];
    const windowStart = rec?.windowStart ?? slot.start;
    const windowEnd = rec?.windowEnd ?? slot.end;

    const winner = await this.winnerFromReference(handle, outcomes, windowStart, windowEnd);
    // The market settles ONLY from an Oracle resolution now, so the receipt is
    // built from the same series the winner came from and submitted first.
    const receipt = await this.windowReceipt(handle, { windowStart, windowEnd, outcomes }, winner);
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

  /** Binary windows: YES (0) wins iff the aura close ≥ the aura at open. */
  private async winnerFromReference(    handle: AuraHandle,
    outcomes: string[],
    windowStartSec: number,
    closeSec: number,
  ): Promise<number> {
    if (outcomes.length === 2 && outcomes[0] === "YES" && outcomes[1] === "NO") {
      const points = await this.series.points(
        `aura:${handle.label}`,
        "aura",
        windowStartSec * 1000,
        closeSec * 1000,
      );
      const open = points[0]?.value ?? handle.aura;
      const close = points[points.length - 1]?.value ?? open;
      return close >= open ? 0 : 1;
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
    const open = points[0]?.value ?? handle.aura;
    const close = points[points.length - 1]?.value ?? open;
    return {
      handleId: handle.id,
      windowStart: win.windowStart,
      windowEnd: win.windowEnd,
      s: close,
      expectation: open,
      delta: close - open,
      indexOpen: open,
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
    const prev = await this.subgraph.previousSettledWindow(handle.id, startSec);
    let funding = MIN_FUNDING;
    if (prev) {
      const volume = await this.subgraph.windowVolume(prev.id);
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
