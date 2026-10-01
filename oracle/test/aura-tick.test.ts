import { describe, it, expect } from "vitest";
import { AuraEngineService } from "../src/jobs/aura/aura-engine.service";
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

function build(opts: { onChain: number; updateOk?: boolean; seriesLast?: number }) {
  const updates: { aura: number; summary: string }[] = [];
  const appends: { value: number; delta: number; inputsHash?: string }[] = [];
  const published: unknown[] = [];

  const chain = {
    onChainAura: async () => opts.onChain,
    updateAura: async (_c: string, aura: number, summary: string) => {
      updates.push({ aura, summary });
      return opts.updateOk ?? true;
    },
  };
  const cache = {
    get: async () => null,
    set: async () => {},
    wrap: async (_k: unknown, _ttl: number, fetch: () => Promise<unknown>) => fetch(),
  };
  const fetcher = { fetch: async () => [ITEM] };
  const ai = { scoreWithSummary: async () => ({ percent: 6, summary: "memo" }) };
  const series = {
    latest: async () =>
      opts.seriesLast === undefined
        ? null
        : { value: opts.seriesLast, delta: 0, timestamp: 0 },
    append: async (_s: string, _m: string, p: { value: number; delta: number; inputsHash?: string }) => {
      appends.push(p);
    },
    points: async () => [],
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
  return { engine, updates, appends, published };
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
    // At the ceiling a +ve move clamps back to the current level: `next === onChain`.
    const { engine, updates, appends } = build({ onChain: 10_000 });
    const tick = await engine.compute(HANDLE, 1_700_000_000_000);

    expect(tick!.aura).toBe(10_000);
    expect(updates).toHaveLength(1); // written even though unchanged
    expect(appends).toHaveLength(1); // and the series still advanced
  });

  it("anchors the next level on the ON-CHAIN value, not a drifted private series", async () => {
    // The private series says 9999 but the chain says 1000 — the chain wins.
    const { engine, updates } = build({ onChain: 1_000, seriesLast: 9_999 });
    const tick = await engine.compute(HANDLE, 1_700_000_000_000);

    // +5% of 1000 = 1050, NOT +5% of 9999.
    expect(tick!.aura).toBe(1050);
    expect(updates[0]!.aura).toBe(1050);
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
});
