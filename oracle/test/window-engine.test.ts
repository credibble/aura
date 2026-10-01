import { describe, it, expect } from "vitest";
import { WindowEngineService } from "../src/jobs/window/window-engine.service";
import type { AuraHandle } from "../src/jobs/jobs.types";

/**
 * The window job's load-bearing guarantees. It decides from the CHAIN
 * (`oracleOf` + `isOpen`) — the indexer lags and can wedge, and depending on it
 * meant a stale "still open" window blocked the next open while hiding the
 * window that needed settling.
 */

const ZERO = "0x0000000000000000000000000000000000000000";
const ORACLE = "0x9b5bc3781edf6C01cc7DFe5b5Fa0dA1bbD640a8b";
/** A slot boundary: 900_000 ms divides evenly, so slotStart is exact. */
const NOW = 900_000_000_000;
const SLOT = NOW / 1000; // 900000000
const SPAN = 900; // 15-minute slots
const PREV = SLOT - SPAN; // 899999100

const HANDLE: AuraHandle = {
  id: "0x726f6e616c646f00000000000000000000000000000000000000000000000000",
  label: "ronaldo",
  contract: "0xB7D774Bd334c6EcF0C574BD5e372dD710599Ee4A",
  sources: [],
  aura: 3040,
  graduated: true,
  categories: [],
  windowMinutes: 15,
};

function build(opts: {
  oracles?: Record<number, string>;
  open?: Record<string, boolean>;
  windows?: unknown[];
  openWindow?: () => Promise<boolean>;
  /** Override the series points `openSlot` prices/strikes from. */
  points?: () => { value: number }[];
  /** Override the handle (e.g. aura 0 to exercise the zero-strike guard). */
  handle?: AuraHandle;
}) {
  const flags = new Map<string, string>();
  const calls: string[] = [];
  const redis = {
    get: async (k: string) => flags.get(k) ?? null,
    set: async (k: string, v: string) => {
      flags.set(k, v);
      return "OK";
    },
  };
  const chain = {
    ready: true,
    oracleOf: async (_label: string, startSec: number) => {
      calls.push(`oracleOf:${startSec}`);
      return opts.oracles?.[startSec] ?? ZERO;
    },
    isOpen: async (oracle: string) => {
      calls.push(`isOpen:${oracle.slice(0, 8)}`);
      return opts.open?.[oracle.toLowerCase()] ?? false;
    },
    openWindow: async () => {
      calls.push("open");
      return opts.openWindow ? opts.openWindow() : true;
    },
    resolveAndSettle: async () => {
      calls.push("settle");
      return true;
    },
  };
  const indexer = {
    openWindows: async () =>
      (opts.windows ?? []) as { oracle: string; windowStart: number; windowEnd: number; outcomes: string[] }[],
    handlesByCategory: async () => [],
    previousSettledWindow: async () => null,
    windowVolume: async () => 0n,
  };
  const engine = new WindowEngineService(
    chain as never,
    indexer as never,
    { publishWindowOpened: () => {}, publishWindowResolved: () => {} } as never,
    { points: async () => opts.points?.() ?? [{ value: 30 }, { value: 31 }] } as never,
    redis as never,
    // No cadence configured in tests → the timing warning is inert.
    { get: () => undefined } as never,
  );
  return { engine, calls, flags };
}

const CLOSED_WINDOW = {
  oracle: ORACLE,
  windowStart: PREV,
  windowEnd: SLOT,
  outcomes: ["YES", "NO"],
};

describe("WindowEngineService", () => {
  it("settles a closed window the indexer has not caught up on (chain-driven)", async () => {
    const { engine, calls } = build({
      oracles: { [PREV]: ORACLE },
      open: { [ORACLE.toLowerCase()]: false },
      windows: [], // indexer has NOTHING — settlement must not depend on it
      openWindow: async () => false,
    });
    // 10s past the boundary: the previous slot closed and its freeze elapsed.
    await engine.tick(HANDLE, NOW + 10_000).catch(() => undefined);
    expect(calls).toContain("settle");
  });

  it("never opens a second window while one is still live", async () => {
    const { engine, calls } = build({
      oracles: { [SLOT]: ORACLE },
      open: { [ORACLE.toLowerCase()]: true },
      windows: [],
    });
    await engine.tick(HANDLE, NOW);
    expect(calls).not.toContain("open");
  });

  it("opens the current slot when nothing is live", async () => {
    const { engine, calls } = build({ windows: [] });
    await engine.tick(HANDLE, NOW);
    expect(calls).toContain("open");
  });

  it("does NOT open a degenerate zero-strike window (aura 0, no history)", async () => {
    const zero: AuraHandle = { ...HANDLE, aura: 0 };
    const { engine, calls } = build({
      windows: [],
      points: () => [{ value: 0 }],
    });
    await engine.tick(zero, NOW);
    expect(calls).not.toContain("open");
  });

  it("does not settle a window that is still inside the freeze buffer", async () => {
    const { engine, calls } = build({
      oracles: { [PREV]: ORACLE },
      open: { [ORACLE.toLowerCase()]: false },
      windows: [{ ...CLOSED_WINDOW, windowEnd: SLOT }],
      openWindow: async () => false,
    });
    // One second after the previous slot closed: still freezing.
    await engine.tick(HANDLE, NOW + 1_000).catch(() => undefined);
    expect(calls).not.toContain("settle");
  });

  it("surfaces a failed open so the slot job retries (no silent windowless slot)", async () => {
    const { engine } = build({ windows: [], openWindow: async () => false });
    await expect(engine.tick(HANDLE, NOW)).rejects.toThrow(/openWindow failed/);
  });
});

/**
 * Settlement must resolve against the window's STRIKE (the level at open), not
 * the first observation INSIDE the window. The aura only ticks when fresh
 * evidence arrives, so a window usually holds 0 or 1 observations; comparing
 * `close >= points[0]` made every single-observation window resolve YES (42/42
 * in production).
 */
const IN_LO = PREV * 1000;
const IN_HI = SLOT * 1000;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

type SettlePoint = { value: number; inputsHash?: string };

function settleHarness(opts: {
  /** The indexer Window.strike (1e2). Omit to force the openSlot fallback. */
  strikeRecord?: number;
  /** Points for the in-window range `[PREV*1000, SLOT*1000]`. */
  inWindow: SettlePoint[];
  /** Points for the strike-reconstruction range (fallback sourcing only). */
  prior?: SettlePoint[];
  /** Override the handle (aura 0 to exercise the zero-strike guard). */
  handle?: AuraHandle;
}) {
  const flags = new Map<string, string>();
  const calls: string[] = [];
  const settles: { oracle: string; receipt: Record<string, unknown>; winner: number }[] = [];
  const redis = {
    get: async (k: string) => flags.get(k) ?? null,
    set: async (k: string, v: string) => {
      flags.set(k, v);
      return "OK";
    },
  };
  const chain = {
    ready: true,
    oracleOf: async (_label: string, startSec: number) => (startSec === PREV ? ORACLE : ZERO),
    isOpen: async () => false,
    openWindow: async () => {
      calls.push("open");
      return true;
    },
    resolveAndSettle: async (
      oracle: string,
      receipt: Record<string, unknown>,
      winner: number,
    ) => {
      calls.push("settle");
      settles.push({ oracle, receipt, winner });
      return true;
    },
  };
  const indexer = {
    openWindows: async () =>
      opts.strikeRecord === undefined
        ? []
        : [
            {
              id: `${HANDLE.id}-${PREV}`,
              handleId: HANDLE.id,
              oracle: ORACLE,
              windowStart: PREV,
              windowEnd: SLOT,
              strike: opts.strikeRecord,
              outcomes: ["YES", "NO"],
              settled: false,
            },
          ],
    previousSettledWindow: async () => null,
    windowVolume: async () => 0n,
  };
  // The series store is queried for several ranges; only the in-window and the
  // strike-reconstruction ranges matter to settlement.
  const points = async (
    _sourceId: string,
    _metric: string,
    fromMs?: number,
    toMs?: number,
  ): Promise<SettlePoint[]> => {
    if (fromMs === IN_LO && toMs === IN_HI) return opts.inWindow;
    if (fromMs === IN_LO - LOOKBACK_MS && toMs === IN_LO) return opts.prior ?? [];
    return [];
  };
  const engine = new WindowEngineService(
    chain as never,
    indexer as never,
    { publishWindowOpened: () => {}, publishWindowResolved: () => {} } as never,
    { points } as never,
    redis as never,
    { get: () => undefined } as never,
  );
  return { engine, calls, settles };
}

describe("WindowEngineService — settlement reference is the strike", () => {
  const EVIDENCE = `0x${"11".repeat(32)}`;

  it("resolves NO when the only in-window observation is below the strike", async () => {
    const { engine, settles } = settleHarness({
      strikeRecord: 4316,
      inWindow: [{ value: 4230 }], // the elon case: falling series
    });
    await engine.tick(HANDLE, NOW + 10_000).catch(() => undefined);
    expect(settles).toHaveLength(1);
    expect(settles[0]!.winner).toBe(1); // NO — not YES (regression)
  });

  it("resolves YES when the close is above the strike", async () => {
    const { engine, settles } = settleHarness({
      strikeRecord: 4316,
      inWindow: [{ value: 4400 }],
    });
    await engine.tick(HANDLE, NOW + 10_000).catch(() => undefined);
    expect(settles[0]!.winner).toBe(0);
  });

  it("resolves YES when the close equals the strike (the documented 'at or above')", async () => {
    const { engine, settles } = settleHarness({
      strikeRecord: 4316,
      inWindow: [{ value: 4316 }],
    });
    await engine.tick(HANDLE, NOW + 10_000).catch(() => undefined);
    expect(settles[0]!.winner).toBe(0);
  });

  it("leaves a zero-observation window unresolved (VOID), never a default YES", async () => {
    const { engine, calls, settles } = settleHarness({
      strikeRecord: 4316,
      inWindow: [], // no aura tick inside the window
    });
    await engine.tick(HANDLE, NOW + 10_000).catch(() => undefined);
    expect(settles).toHaveLength(0);
    expect(calls).not.toContain("settle");
  });

  it("commits the strike as the receipt's expectation and indexOpen", async () => {
    const { engine, settles } = settleHarness({
      strikeRecord: 4316,
      inWindow: [{ value: 4230, inputsHash: EVIDENCE }],
    });
    await engine.tick(HANDLE, NOW + 10_000).catch(() => undefined);
    const receipt = settles[0]!.receipt;
    expect(receipt.expectation).toBe(4316);
    expect(receipt.indexOpen).toBe(4316);
    expect(receipt.indexClose).toBe(4230);
    expect(receipt.direction).toBe(false);
    // indexClose/indexOpen are the on-chain-observable levels, and the close's
    // evidence is committed into the receipt.
    expect(receipt.inputsHash).toBe(EVIDENCE);
  });

  it("does NOT settle a zero-strike window — leaves it to VOID", async () => {
    const zero: AuraHandle = { ...HANDLE, aura: 0 };
    const { engine, calls, settles } = settleHarness({
      // No indexer strike → reconstruct from the prior series (all zero).
      inWindow: [{ value: 0, inputsHash: EVIDENCE }],
      prior: [{ value: 0 }],
      handle: zero,
    });
    await engine.tick(zero, NOW + 10_000).catch(() => undefined);
    expect(settles).toHaveLength(0);
    expect(calls).not.toContain("settle");
  });

  it("reconstructs the strike exactly as openSlot did when the indexer record is absent", async () => {
    const { engine, settles } = settleHarness({
      // no strikeRecord → no indexer window record → fallback reconstruction
      inWindow: [{ value: 4230 }],
      // openSlot's strikeFor() takes the LAST point in the pricing lookback.
      prior: [{ value: 4400 }, { value: 4316 }],
    });
    await engine.tick(HANDLE, NOW + 10_000).catch(() => undefined);
    expect(settles).toHaveLength(1);
    expect(settles[0]!.winner).toBe(1); // 4230 < 4316
    expect(settles[0]!.receipt.expectation).toBe(4316);
    expect(settles[0]!.receipt.indexOpen).toBe(4316);
  });
});

/**
 * FREEZE-ON-RESOLVE: the aura worker calls `settleOnObservation` right after a
 * tick. If the handle has a LIVE window, that observation IS the close — the
 * window resolves/settles before its scheduled `windowEnd`, freezing trading the
 * moment the winner is public. A window with no observation is left to VOID.
 */
function earlyHarness(opts: {
  /** The indexer Window.strike (1e2). Omit to force the fallback path. */
  strikeRecord?: number;
  /** Whether the chain reports the window tradable. */
  open?: boolean;
  /** Points for the in-window range `[SLOT*1000, (SLOT+SPAN)*1000]`. */
  inWindow?: SettlePoint[];
  /** Points for the strike-reconstruction range (fallback sourcing only). */
  prior?: SettlePoint[];
}) {
  const flags = new Map<string, string>();
  const calls: string[] = [];
  const settles: { oracle: string; receipt: Record<string, unknown>; winner: number }[] = [];
  const redis = {
    get: async (k: string) => flags.get(k) ?? null,
    set: async (k: string, v: string) => {
      flags.set(k, v);
      return "OK";
    },
  };
  const chain = {
    ready: true,
    oracleOf: async (_label: string, startSec: number) => (startSec === SLOT ? ORACLE : ZERO),
    isOpen: async () => opts.open ?? true,
    resolveAndSettle: async (
      oracle: string,
      receipt: Record<string, unknown>,
      winner: number,
    ) => {
      calls.push("settle");
      settles.push({ oracle, receipt, winner });
      return true;
    },
  };
  const indexer = {
    openWindows: async () =>
      opts.strikeRecord === undefined
        ? []
        : [
            {
              id: `${HANDLE.id}-${SLOT}`,
              handleId: HANDLE.id,
              oracle: ORACLE,
              windowStart: SLOT,
              windowEnd: SLOT + SPAN,
              strike: opts.strikeRecord,
              outcomes: ["YES", "NO"],
              settled: false,
            },
          ],
    previousSettledWindow: async () => null,
    windowVolume: async () => 0n,
  };
  const points = async (
    _sourceId: string,
    _metric: string,
    fromMs?: number,
    toMs?: number,
  ): Promise<SettlePoint[]> => {
    if (fromMs === SLOT * 1000 && toMs === (SLOT + SPAN) * 1000) return opts.inWindow ?? [];
    if (fromMs === SLOT * 1000 - LOOKBACK_MS && toMs === SLOT * 1000) return opts.prior ?? [];
    return [];
  };
  const engine = new WindowEngineService(
    chain as never,
    indexer as never,
    { publishWindowOpened: () => {}, publishWindowResolved: () => {} } as never,
    { points } as never,
    redis as never,
    { get: () => undefined } as never,
  );
  return { engine, calls, settles };
}

describe("WindowEngineService — early close on the first in-window observation", () => {
  const EVIDENCE = `0x${"22".repeat(32)}`;

  it("early-settles a live window with the observed close against the strike (YES)", async () => {
    const { engine, settles, calls } = earlyHarness({
      strikeRecord: 4316,
      inWindow: [{ value: 4400 }],
    });
    // The tick lands well before windowEnd (SLOT + 900).
    const settled = await engine.settleOnObservation(HANDLE, 4400, NOW + 60_000, EVIDENCE);

    expect(settled).toBe(true);
    expect(calls).toContain("settle");
    expect(settles).toHaveLength(1);
    expect(settles[0]!.oracle).toBe(ORACLE);
    expect(settles[0]!.winner).toBe(0); // 4400 ≥ 4316 → YES
    expect(settles[0]!.receipt.indexClose).toBe(4400); // the OBSERVED close
    expect(settles[0]!.receipt.expectation).toBe(4316); // the strike
    expect(settles[0]!.receipt.indexOpen).toBe(4316);
    expect(settles[0]!.receipt.direction).toBe(true);
    // The tick's evidence hash is committed into the resolution receipt.
    expect(settles[0]!.receipt.inputsHash).toBe(EVIDENCE);
  });

  it("early-settles below the strike as NO, using the observation as the close", async () => {
    const { engine, settles } = earlyHarness({
      strikeRecord: 4316,
      inWindow: [{ value: 4230 }],
    });
    await engine.settleOnObservation(HANDLE, 4230, NOW + 60_000);
    expect(settles[0]!.winner).toBe(1);
    expect(settles[0]!.receipt.indexClose).toBe(4230);
    expect(settles[0]!.receipt.direction).toBe(false);
  });

  it("does nothing when the handle has no live window", async () => {
    const { engine, settles, calls } = earlyHarness({ open: false, strikeRecord: 4316 });
    const settled = await engine.settleOnObservation(HANDLE, 4400, NOW + 60_000);
    expect(settled).toBe(false);
    expect(settles).toHaveLength(0);
    expect(calls).not.toContain("settle");
  });

  it("reconstructs the strike from the series when the indexer record is absent", async () => {
    const { engine, settles } = earlyHarness({
      inWindow: [{ value: 4230 }],
      prior: [{ value: 4400 }, { value: 4316 }],
    });
    await engine.settleOnObservation(HANDLE, 4230, NOW + 60_000);
    expect(settles).toHaveLength(1);
    expect(settles[0]!.winner).toBe(1); // 4230 < 4316
    expect(settles[0]!.receipt.expectation).toBe(4316);
  });
});
