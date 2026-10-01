import { describe, it, expect } from "vitest";
import { parseSummary } from "../src/adapters/ai/llm/kimi-ai.model";

/**
 * The AI's per-tick contract: a signed PERCENT (clamped to ±20) plus the SHORT
 * memo that gets written on-chain as `Handle.updateAura`'s summary.
 */

describe("parseSummary — percent", () => {
  it("reads the percent and its memo", () => {
    const r = parseSummary('{"percent": -12, "summary": "injury doubt ahead of the derby"}');
    expect(r.percent).toBe(-12);
    expect(r.summary).toBe("injury doubt ahead of the derby");
  });

  it("clamps beyond the ±20 band and rounds to one decimal", () => {
    expect(parseSummary('{"percent": -30, "summary": "x"}').percent).toBe(-20);
    expect(parseSummary('{"percent": 42, "summary": "x"}').percent).toBe(20);
    expect(parseSummary('{"percent": 1.24, "summary": "x"}').percent).toBe(1.2);
  });

  it("accepts a numeric string and the legacy `aura` key", () => {
    expect(parseSummary('{"percent": "-2.5", "summary": "x"}').percent).toBe(-2.5);
    expect(parseSummary('{"aura": 1.5, "summary": "x"}').percent).toBe(1.5);
  });

  it("survives a bare number reply (no JSON)", () => {
    expect(parseSummary("+2.5").percent).toBe(2.5);
    expect(parseSummary("-0.4").percent).toBe(-0.4);
  });

  it("treats junk as 0 rather than NaN", () => {
    expect(parseSummary("no idea").percent).toBe(0);
    expect(parseSummary('{"percent": "abc"}').percent).toBe(0);
  });
});

describe("parseSummary — the on-chain memo", () => {
  it("collapses whitespace and strips quotes/angle brackets", () => {
    const r = parseSummary('{"percent": 2, "summary": "  goals   in   \\"three\\"  <derby>  "}');
    expect(r.summary).toBe("goals in three derby");
  });

  it("drops a trailing period (the memo is a fragment, not a sentence)", () => {
    expect(parseSummary('{"percent": 2, "summary": "record broken."}').summary).toBe("record broken");
  });

  it("caps at 120 chars with an ellipsis — it is written on-chain, so length is gas", () => {
    const long = "a".repeat(300);
    const { summary } = parseSummary(`{"percent": 1, "summary": "${long}"}`);
    expect(summary.length).toBeLessThanOrEqual(120);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("is empty when the model gives none (the engine then writes a factual fallback)", () => {
    expect(parseSummary('{"percent": 2}').summary).toBe("");
  });
});
