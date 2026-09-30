import { describe, it, expect } from "vitest";
import { WindowEngineService } from "../src/jobs/window/window-engine.service";
import type { AuraHandle } from "../src/jobs/jobs.types";

/**
 * The window job's load-bearing guarantees. It decides from the CHAIN
 * (`oracleOf` + `isOpen`) — the subgraph lags and can wedge, and depending on it
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
  const subgraph = {
    openWindows: async () =>
      (opts.windows ?? []) as { oracle: string; windowStart: number; windowEnd: number; outcomes: string[] }[],
    handlesByCategory: async () => [],
    previousSettledWindow: async () => null,
    windowVolume: async () => 0n,
  };
  const engine = new WindowEngineService(
    chain as never,
    subgraph as never,
    { publishWindowOpened: () => {}, publishWindowResolved: () => {} } as never,
    { points: async () => [{ value: 30 }, { value: 31 }] } as never,
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
