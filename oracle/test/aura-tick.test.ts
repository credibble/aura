import { describe, it, expect, vi } from "vitest";
import { AuraEngineService } from "../src/jobs/aura/aura-engine.service";
import { KimiAiModel } from "../src/adapters/ai/llm/kimi-ai.model";
import type { AuraHandle } from "../src/jobs/jobs.types";
import type { RawDatum } from "../src/core/domain/source-item";
import type { Source } from "../src/core/domain/source";

/**
 * The "one series" invariant: every aura tick that can matter is written
 * ON-CHAIN, and the oracle's private series is appended only AFTER that write
 * succeeds — so the chain's `AuraHistory` and the resolution series are the same
 * sequence. A tick that cannot be observed on-chain must not exist privately.
 */

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

const ITEM: RawDatum = {
  id: "item-1",
  sourceName: "BBC",
  text: "a fresh story",
  publishedAt: Number.MAX_SAFE_INTEGER, // never ages out during the test
  engagement: 10,
};

const SOURCE: Source = {
  id: "bbc-news",
  kind: "media",
  weight: 800,
  fetchIntervalMs: 0,
  label: "BBC Sport",
};

function build(opts: {
  onChain: number;
  updateOk?: boolean;
  seriesLast?: number;
  /** Persisted engine state (`baseline`/`baseline_center` metrics). */
  baselineLast?: number;
  centerLast?: number;
  /** Aura series history the engine seeds the center from. */
  history?: { value: number }[];
  /** Inject a different AI model (e.g. the real DEBUG_MODE sampler). */
  ai?: unknown;
  /** Item ids already scored — makes `freshItems` return nothing. */
  sentIds?: string[];
}) {
  const updates: { aura: number; summary: string }[] = [];
  const appends: { value: number; delta: number; inputsHash?: string }[] = [];
  const allAppends: { metric: string; value: number }[] = [];
  const published: unknown[] = [];

  const chain = {
    onChainAura: async () => opts.onChain,
    updateAura: async (_c: string, aura: number, summary: string) => {
      updates.push({ aura, summary });
      return opts.updateOk ?? true;
    },
  };
  const cache = {
    get: async () => (opts.sentIds ? { ids: opts.sentIds } : null),
    set: async () => {},
    wrap: async (_k: unknown, _ttl: number, fetch: () => Promise<unknown>) => fetch(),
  };
  const fetcher = { fetch: async () => [ITEM] };
  const ai = (opts.ai ?? { scoreWithSummary: async () => ({ percent: 6, summary: "memo" }) }) as never;
  const series = {
    latest: async (_s: string, metric: string) => {
      if (metric === "aura" && opts.seriesLast !== undefined)
        return { value: opts.seriesLast, delta: 0, timestamp: 0 };
      if (metric === "baseline" && opts.baselineLast !== undefined)
        return { value: opts.baselineLast, delta: 0, timestamp: 0 };
      if (metric === "baseline_center" && opts.centerLast !== undefined)
        return { value: opts.centerLast, delta: 0, timestamp: 0 };
      return null;
    },
    append: async (
      _s: string,
      metric: string,
      p: { value: number; delta?: number; inputsHash?: string },
    ) => {
      allAppends.push({ metric, value: p.value });
      // The `aura` metric is the chain mirror the original tests assert on.
      if (metric === "aura") appends.push({ value: p.value, delta: p.delta ?? 0, inputsHash: p.inputsHash });
    },
    points: async () => opts.history ?? [],
  };
  const registry = { sourcesForHandle: async () => [SOURCE] };
  const ws = { publishAura: (m: unknown) => published.push(m) };
  const config = { get: () => undefined };

  const engine = new AuraEngineService(
    config as never,
    fetcher as never,
    cache as never,
    chain as never,
    ws as never,
    ai as never,
    series as never,
    registry as never,
  );
  return { engine, updates, appends, allAppends, published };
}

describe("AuraEngineService — one series (on-chain is the source of truth)", () => {
  it("writes every tick on-chain and mirrors it into the series with its evidence hash", async () => {
    const { engine, updates, appends, published } = build({ onChain: 3040 });
    const tick = await engine.compute(HANDLE, 1_700_000_000_000);

    expect(tick).not.toBeNull();
    expect(updates).toHaveLength(1);
    expect(updates[0]!.aura).toBe(tick!.aura);
    // The series point exists, mirrors the on-chain value and carries the hash.
    expect(appends).toHaveLength(1);
    expect(appends[0]!.value).toBe(tick!.aura);
    expect(appends[0]!.inputsHash).toBe(tick!.inputsHash);
    expect(tick!.inputsHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect((published[0] as { inputsHash: string }).inputsHash).toBe(tick!.inputsHash);
  });

  it("still writes on-chain when the level is unchanged (history stays complete)", async () => {
    // A persisted baseline at the ceiling: the +ve band move is clamped back to
    // the current level, so `next === onChain`.
    const { engine, updates, appends } = build({ onChain: 10_000, baselineLast: 10_000, centerLast: 10_000 });
    const tick = await engine.compute(HANDLE, 1_700_000_000_000);

    expect(tick!.aura).toBe(10_000);
    expect(updates).toHaveLength(1); // written even though unchanged
    expect(appends).toHaveLength(1); // and the series still advanced
  });

  it("recovers from the ceiling instead of pinning (the saturation bug)", async () => {
    // No persisted state: the center is seeded from the handle's aura history
    // (its opening level), NOT the saturated current level, so a +ve bias can no
    // longer hold the index at MAX.
    const { engine, updates, appends, allAppends } = build({
      onChain: 10_000,
      history: [{ value: 3_550 }], // the handle opened at 35.50
    });
    const tick = await engine.compute(HANDLE, 1_700_000_000_000);

    expect(tick!.aura).toBeLessThan(10_000); // moved off the ceiling
    expect(tick!.aura).toBeGreaterThan(3_550);
    expect(updates[0]!.aura).toBe(tick!.aura);
    expect(appends).toHaveLength(1);
    // Engine state is persisted for the next tick (baseline + seeded center).
    expect(allAppends.find((a) => a.metric === "baseline")).toBeDefined();
    expect(allAppends.find((a) => a.metric === "baseline_center")?.value).toBe(3_550);
  });

  it("anchors the next level on the ON-CHAIN value, not a drifted private series", async () => {
    // The private series says 9999 but the chain says 1000 — the chain wins.
    const { engine, updates } = build({ onChain: 1_000, seriesLast: 9_999 });
    const tick = await engine.compute(HANDLE, 1_700_000_000_000);

    // The +5% band move on 1000, reverted by 20% on the fresh deviation:
    // 1000 + 0.8 × 5% × 1000 = 1040 — and definitely NOT anything near 9999.
    expect(tick!.aura).toBe(1040);
    expect(updates[0]!.aura).toBe(1040);
  });

  it("drops the tick (no series point, no early settle) when the on-chain write fails", async () => {
    const { engine, updates, appends, published } = build({
      onChain: 3040,
      updateOk: false,
    });
    const tick = await engine.compute(HANDLE, 1_700_000_000_000);

    expect(tick).toBeNull();
    expect(updates).toHaveLength(1); // attempted
    expect(appends).toHaveLength(0); // never became a private-only point
    expect(published).toHaveLength(0);
  });

  it("still ticks with DEBUG_MODE on using the real (sampling) AI model", async () => {
    const previous = process.env.DEBUG_MODE;
    process.env.DEBUG_MODE = "true";
    try {
      // The real model, wired to a fetch that FAILS if ever called — proving the
      // engine's tick comes from the debug sampler, not the provider.
      const fetchFn = vi.fn(async () => {
        throw new Error("fetch must not be called in DEBUG_MODE");
      });
      const model = new KimiAiModel({ get: () => undefined } as never, fetchFn as never);

      const { engine, updates, appends } = build({ onChain: 3040, ai: model });
      const tick = await engine.compute(HANDLE, 1_700_000_000_000);

      expect(tick).not.toBeNull();
      expect(updates).toHaveLength(1); // written on-chain
      expect(updates[0]!.summary).toContain("[debug]");
      expect(updates[0]!.summary).toContain("no AI call");
      expect(appends).toHaveLength(1); // mirrored into the series
      expect(tick!.aura).toBeGreaterThan(0);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.DEBUG_MODE;
      else process.env.DEBUG_MODE = previous;
    }
  });

  it("still ticks when no NEW items arrived — falls back to recent items (no starved windows)", async () => {
    // Every item is already in the Redis `sent` set, so `freshItems` returns
    // nothing. Before, the engine skipped the tick entirely (no aura point → the
    // window had no observation → void). It must now score the recent items.
    const { engine, updates, appends } = build({ onChain: 3040, sentIds: ["item-1"] });
    const tick = await engine.compute(HANDLE, 1_700_000_000_000);

    expect(tick).not.toBeNull();
    expect(updates).toHaveLength(1); // written on-chain → observable in the window
    expect(appends).toHaveLength(1); // and mirrored into the resolution series
  });
});
