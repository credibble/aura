import { describe, it, expect } from "vitest";
import { evidenceWeight, appliedPercent, hashTick, countLine } from "../src/jobs/aura/aura-engine.service";

/**
 * The deterministic half of a tick: how much the AI's magnitude is trusted, the
 * audit hash, and the engagement line. The model proposes a size; these decide it.
 */

const items = (n: number) => Array.from({ length: n }, (_, i) => `item ${i}`);

describe("evidenceWeight", () => {
  it("scales with credibility-weighted item volume", () => {
    const weak = evidenceWeight([{ weight: 300, items: items(1) }]);
    const strong = evidenceWeight([{ weight: 1000, items: items(4) }]);
    expect(weak).toBeLessThan(strong);
    expect(strong).toBe(1);
  });

  it("never drops below the floor, even with no items at all", () => {
    expect(evidenceWeight([])).toBe(0.25);
    expect(evidenceWeight([{ weight: 1000, items: [] }])).toBe(0.25);
  });

  it("adds a bounded reach bonus for engagement (never above 1)", () => {
    const noReach = evidenceWeight([{ weight: 1000, items: items(2) }]);
    const viral = evidenceWeight([{ weight: 1000, items: items(2), engagement: 5_000_000 }]);
    expect(viral).toBeGreaterThan(noReach);
    expect(viral).toBeLessThanOrEqual(1);
  });

  it("is deterministic — same inputs, same weight", () => {
    const a = [{ weight: 840, items: items(3), engagement: 12_345 }];
    expect(evidenceWeight(a)).toBe(evidenceWeight([...a]));
  });

  it("treats a low-credibility flood as weaker than one credible report", () => {
    const flood = evidenceWeight([{ weight: 200, items: items(8) }]);
    const credible = evidenceWeight([{ weight: 1000, items: items(3) }]);
    expect(flood).toBeLessThan(credible);
  });
});

describe("appliedPercent — the applied move stays inside ±5–20%", () => {
  it("floors a weak-evidence move at the minimum magnitude", () => {
    // 5% × 0.25 = 1.25 before the re-clamp; the applied move must still be 5.
    expect(appliedPercent(5, 0.25)).toBe(5);
    expect(appliedPercent(-5, 0.25)).toBe(-5);
  });

  it("caps the applied move at the maximum even for an absurd AI answer", () => {
    expect(appliedPercent(50, 1)).toBe(20);
    expect(appliedPercent(-99, 1)).toBe(-20);
  });

  it("lets evidence modulate WITHIN the band", () => {
    expect(appliedPercent(20, 0.5)).toBe(10);
    expect(appliedPercent(12, 1)).toBe(12);
  });

  it("never yields a dead (zero) tick", () => {
    expect(appliedPercent(0, 0.25)).toBe(5);
  });
});

describe("hashTick", () => {
  const base = { handleId: "0xabc", ts: 1_700_000_000, base: 3040, itemIds: ["a", "b"], rawReply: 2.5, percent: 2.5 };

  it("is a stable keccak of the inputs", () => {
    expect(hashTick(base)).toBe(hashTick({ ...base }));
    expect(hashTick(base)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("changes when ANY input changes (so a replay can be verified)", () => {
    expect(hashTick({ ...base, rawReply: 2.6 })).not.toBe(hashTick(base));
    expect(hashTick({ ...base, itemIds: ["a", "c"] })).not.toBe(hashTick(base));
    expect(hashTick({ ...base, base: 3041 })).not.toBe(hashTick(base));
  });
});

describe("countLine", () => {
  it("renders the endpoint's engagement as one compact line", () => {
    expect(countLine({ likes: 12_400, replies: 340, views: 88_000 })).toBe(
      "12.4K likes · 340 replies · 88.0K views",
    );
  });

  it("maps Reddit's score/ratio keys to human labels and drops zeroes", () => {
    expect(countLine({ score: 512, replies: 0, upvoteRatio: 94 })).toBe(
      "512 upvotes · 94% upvoted",
    );
  });

  it("is empty when there is nothing to show", () => {
    expect(countLine(undefined)).toBe("");
    expect(countLine({ likes: 0 })).toBe("");
  });
});
