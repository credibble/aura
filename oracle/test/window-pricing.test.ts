import { describe, it, expect } from "vitest";
import {
  normalCdf,
  strikeFor,
  windowPriors,
  stepSeconds,
} from "../src/jobs/window/window-pricing";

/**
 * The window pricing model — the strike is the level at open, and the odds are
 * Φ(risk-adjusted drift · √horizon) off the handle's own aura series. These tests
 * pin the properties that make it a *model* rather than a 50/50 stub.
 */

const ONE = 10n ** 18n;
const sum = (p: [string, string]) => BigInt(p[0]) + BigInt(p[1]);

describe("normalCdf", () => {
  it("is 0.5 at zero and monotone", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeGreaterThan(0.5);
    expect(normalCdf(-1)).toBeLessThan(0.5);
    // 1σ ≈ 84.1%, 2σ ≈ 97.7% (the textbook values, within the erf approximation)
    expect(normalCdf(1)).toBeCloseTo(0.8413, 3);
    expect(normalCdf(2)).toBeCloseTo(0.9772, 3);
  });
});

describe("strikeFor", () => {
  it("uses the series close when there is one", () => {
    expect(strikeFor([100, 105, 110], 90)).toBe(110);
  });
  it("falls back to the on-chain level for an empty/odd series", () => {
    expect(strikeFor([], 3040)).toBe(3040);
    expect(strikeFor([0], 3040)).toBe(3040);
  });
});

describe("stepSeconds", () => {
  it("is the median gap, robust to one long hole", () => {
    expect(stepSeconds([0, 600, 1200, 1800, 9000])).toBe(600);
  });
  it("is 0 when there is no history", () => {
    expect(stepSeconds([5])).toBe(0);
    expect(stepSeconds([])).toBe(0);
  });
});

describe("windowPriors", () => {
  it("prices a rising series above 50/50 and a falling one below", () => {
    const rising = [100, 101, 102.5, 104, 106, 108.5, 111];
    const falling = [111, 110, 108.5, 106, 104, 102.5, 100];
    const up = windowPriors({ points: rising, windowSec: 900, stepSec: 600 });
    const down = windowPriors({ points: falling, windowSec: 900, stepSec: 600 });

    expect(up.model.fallback).toBe(false);
    expect(up.model.pYes).toBeGreaterThan(0.5);
    expect(down.model.pYes).toBeLessThan(0.5);
    // Symmetric series → symmetric odds around 50%.
    expect(up.model.pYes + down.model.pYes).toBeCloseTo(1, 6);
  });

  it("emits 1e18 probabilities that sum to EXACTLY 1e18 and never hit 0 or 1", () => {
    for (const points of [
      [100, 101, 102, 103, 104],
      [104, 103, 102, 101, 100],
      [100, 100.5, 100.2, 100.9, 101.4],
    ]) {
      const { probabilities } = windowPriors({ points, windowSec: 900, stepSec: 600 });
      expect(sum(probabilities)).toBe(ONE);
      const yes = BigInt(probabilities[0]);
      expect(yes).toBeGreaterThan(0n);
      expect(yes).toBeLessThan(ONE);
    }
  });

  it("clamps a runaway drift to the [2%, 98%] band (a zero/unity leg is unpriceable)", () => {
    // Monotone +20% each step: the raw z is enormous.
    const rocket = [100, 120, 144, 172.8, 207.36, 248.832];
    const { probabilities, model } = windowPriors({ points: rocket, windowSec: 3600, stepSec: 600 });
    expect(model.pYes).toBeLessThanOrEqual(0.98);
    expect(model.pYes).toBeGreaterThan(0.9);
    expect(sum(probabilities)).toBe(ONE);
  });

  it("falls back to 50/50 when the series cannot support a model", () => {
    const flat = [100, 100, 100, 100];
    const tooShort = [100, 101];
    for (const points of [flat, tooShort, []]) {
      const { probabilities, model } = windowPriors({ points, windowSec: 900, stepSec: 600 });
      expect(model.fallback).toBe(true);
      expect(probabilities).toEqual(["500000000000000000", "500000000000000000"]);
    }
  });

  it("scales with the horizon: the same drift is more confident over more steps", () => {
    // Noisy but mildly up-biased: μ/σ < 1, so neither horizon hits the clamp and
    // the √T scaling is visible (a SMOOTH climb is already ≥98% and would clamp).
    const series = [100, 101.2, 100.39, 101.49, 100.78, 101.79, 101.18];
    const short = windowPriors({ points: series, windowSec: 600, stepSec: 600 });
    const long = windowPriors({ points: series, windowSec: 3600, stepSec: 600 });
    expect(short.model.fallback).toBe(false);
    expect(long.model.steps).toBeGreaterThan(short.model.steps);
    expect(short.model.pYes).toBeGreaterThan(0.5);
    expect(long.model.pYes).toBeGreaterThan(short.model.pYes);
    expect(long.model.pYes).toBeLessThan(0.98); // still inside the band
  });
});
