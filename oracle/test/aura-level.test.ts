import { describe, it, expect } from "vitest";
import {
  applyAuraLevel,
  appliedPercent,
  DEFAULT_AURA_LEVEL_PARAMS,
  AURA_DEVIATION_MAX,
  type AuraLevelParams,
  type AuraLevelState,
} from "../src/jobs/aura/aura-engine.service";

/**
 * The bounded, mean-reverting level model — the fix for the index ratcheting to
 * `MAX_AURA` (= 100.00) and saturating, which left windows with no movement and
 * voided them.
 *
 * The load-bearing property is behavioural, so most of this file is a
 * deterministic SIMULATION of a week of real-cadence ticks under a
 * positive-biased AI. `applyAuraLevel` is the exact function the engine runs.
 */

const AURA_MAX = 10_000;
/** One AI-scored tick every 10 minutes: 7 days × 24 h × 6. */
const TICKS_PER_WEEK = 7 * 24 * 6;

/** Deterministic PRNG so the assertions below are stable across machines. */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimResult {
  levels: number[];
  /** Fraction of ticks whose level is in the top 5% of the aura range. */
  top5Fraction: number;
  /** Longest consecutive run of ticks pinned at exactly MAX_AURA. */
  longestMaxRun: number;
  /** Highest level reached once the opening correction is over. */
  maxAfterWarmup: number;
  /** Ticks until the level first sits inside its ±D_MAX band (1-based). */
  ticksToBand: number;
  stdev: number;
  rises: number;
  falls: number;
}

/**
 * A week of ticks for one handle. `pPos` is the probability the AI reads
 * positive — >0.5 is the "mild upward bias" that pinned the old model.
 */
function simulate(opts: {
  center: number;
  seed: number;
  pPos: number;
  ticks?: number;
  startLevel?: number;
  params?: AuraLevelParams;
}): SimResult {
  const params = opts.params ?? DEFAULT_AURA_LEVEL_PARAMS;
  const ticks = opts.ticks ?? TICKS_PER_WEEK;
  const rnd = mulberry32(opts.seed);
  let level = opts.startLevel ?? AURA_MAX;
  let state: AuraLevelState = { baseline: Math.min(opts.center, AURA_MAX), center: opts.center };

  const levels: number[] = [];
  let top = 0;
  let maxRun = 0;
  let run = 0;
  let maxAfterWarmup = 0;
  let ticksToBand = 0;
  let rises = 0;
  let falls = 0;

  for (let t = 0; t < ticks; t++) {
    // The real AI band: a signed ±5–20% move. `appliedPercent` is the engine's
    // own clamp, so the simulation cannot drift from production semantics.
    const raw = (rnd() < opts.pPos ? 1 : -1) * (5 + rnd() * 15);
    const percent = appliedPercent(raw, 1);

    const prev = level;
    const update = applyAuraLevel(level, percent, state, params);
    level = update.level;
    state = { baseline: update.baseline, center: state.center };

    if (level > prev) rises++;
    else if (level < prev) falls++;
    levels.push(level);
    if (level > 0.95 * AURA_MAX) top++;
    if (level >= AURA_MAX) {
      run++;
      maxRun = Math.max(maxRun, run);
    } else {
      run = 0;
    }
    if (t > 0 && level > maxAfterWarmup) maxAfterWarmup = level;
    if (ticksToBand === 0 && level >= state.baseline - params.deviationMax && level <= state.baseline + params.deviationMax) {
      ticksToBand = t + 1;
    }
  }

  const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
  const stdev = Math.sqrt(levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length);
  return {
    levels,
    top5Fraction: top / levels.length,
    longestMaxRun: maxRun,
    maxAfterWarmup,
    ticksToBand,
    stdev,
    rises,
    falls,
  };
}

describe("applyAuraLevel — bounded, mean-reverting", () => {
  it("starts a fresh handle at its baseline; the first band move opens a deviation", () => {
    const out = applyAuraLevel(3_000, 5, { baseline: 3_000, center: 3_000 });
    // 0.8 × 5% × 3000 = +120, not the old full +150.
    expect(out.level).toBe(3_120);
    expect(out.delta).toBe(120);
    expect(out.baseline).toBeGreaterThan(3_000);
    expect(out.baseline).toBeLessThanOrEqual(3_012);
  });

  it("clamps the deviation to ±D_MAX around the baseline", () => {
    // From the ceiling with the baseline far below, the deviation is capped.
    const out = applyAuraLevel(10_000, 20, { baseline: 3_000, center: 3_000 });
    expect(out.level).toBeLessThanOrEqual(3_000 + AURA_DEVIATION_MAX);
    expect(out.level).toBeGreaterThan(3_000);
  });

  it("applies the AI's percent to the LEVEL, so D = 0 is not an absorbing state", () => {
    // The literal `D ← D·(1 + p/100)` form freezes forever at D = 0. Applying
    // the percent to the level avoids that: the same state keeps moving.
    let level = 3_000;
    let state: AuraLevelState = { baseline: 3_000, center: 3_000 };
    for (let i = 0; i < 3; i++) {
      const out = applyAuraLevel(level, 10, state);
      expect(out.level).not.toBe(level);
      state = { baseline: out.baseline, center: state.center };
      level = out.level;
    }
  });

  it("reverts a shock: a one-direction run stays inside its band instead of compounding", () => {
    // 20 identical +20% ticks settle at a bounded level inside the ±D_MAX band
    // (the baseline itself drifts up a little, so the band moves with it).
    let level = 3_000;
    let state: AuraLevelState = { baseline: 3_000, center: 3_000 };
    const seen: number[] = [];
    for (let i = 0; i < 20; i++) {
      const out = applyAuraLevel(level, 20, state);
      level = out.level;
      state = { baseline: out.baseline, center: state.center };
      seen.push(level);
      // Every step honours the band around the current baseline.
      expect(level).toBeLessThanOrEqual(state.baseline + AURA_DEVIATION_MAX);
      expect(level).toBeGreaterThanOrEqual(state.baseline - AURA_DEVIATION_MAX);
    }
    // The baseline's offset from the center is bounded (≈ eta/anchor · D_MAX),
    // so the level cannot run far past center + D_MAX either.
    expect(seen[seen.length - 1]!).toBeLessThanOrEqual(3_000 + 2 * AURA_DEVIATION_MAX);
  });
});

describe("aura index simulation — a week of 10-minute positive-biased ticks", () => {
  it("never saturates: the level does not pin to MAX and rarely enters the top 5%", () => {
    // Several handles across the real opening-value range, many seeds, a mild
    // positive bias (pPos 0.75 → E[percent] ≈ +6.25).
    const centers = [2_180, 2_875, 3_550, 4_290];
    for (const center of centers) {
      for (let seed = 1; seed <= 25; seed++) {
        const r = simulate({ center, seed, pPos: 0.75 });
        expect(r.top5Fraction).toBeLessThan(0.02);
        expect(r.longestMaxRun).toBe(0);
        expect(r.maxAfterWarmup).toBeLessThan(0.95 * AURA_MAX);
      }
    }
  });

  it("does not saturate even under a strong positive bias", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = simulate({ center: 4_290, seed, pPos: 0.9 });
      expect(r.top5Fraction).toBeLessThan(0.02);
      expect(r.longestMaxRun).toBe(0);
    }
  });

  it("keeps a healthy band: meaningful spread and both rises and falls", () => {
    for (const center of [2_180, 3_550, 4_290]) {
      const r = simulate({ center, seed: 7, pPos: 0.75 });
      // Spread well above a hand-wave floor (~2.5 display points), observed ≳ 8.
      expect(r.stdev).toBeGreaterThan(250);
      // Falls happen even though the AI is biased upward.
      expect(r.rises).toBeGreaterThan(0);
      expect(r.falls).toBeGreaterThan(0.1 * TICKS_PER_WEEK);
    }
  });

  it("returns from the ceiling into the band within a bounded number of ticks", () => {
    // The live state: every handle pinned at MAX_AURA. The opening correction
    // must land the level back inside ±D_MAX quickly.
    for (const center of [2_180, 3_550, 4_290]) {
      const r = simulate({ center, seed: 3, pPos: 0.85 });
      expect(r.ticksToBand).toBeGreaterThan(0);
      expect(r.ticksToBand).toBeLessThanOrEqual(20);
    }
  });

  it("regression witness: the OLD accumulating rule DID saturate under the same bias", () => {
    // The pre-fix rule: level ← clamp(round(level·(1+p/100)), 0, MAX) + floor.
    // Same seeded, positive-biased stream — shows why the simulation above is
    // not a tautology.
    const rnd = mulberry32(11);
    let level = 3_000;
    let top = 0;
    let maxRun = 0;
    let run = 0;
    const ticks = TICKS_PER_WEEK;
    for (let t = 0; t < ticks; t++) {
      const raw = (rnd() < 0.75 ? 1 : -1) * (5 + rnd() * 15);
      const percent = appliedPercent(raw, 1);
      const next = Math.min(AURA_MAX, Math.max(0, Math.round((level * (100 + percent)) / 100)));
      level = next === level ? Math.min(AURA_MAX, Math.max(0, level + (percent < 0 ? -1 : 1))) : next;
      if (level > 0.95 * AURA_MAX) top++;
      if (level >= AURA_MAX) {
        run++;
        maxRun = Math.max(maxRun, run);
      } else {
        run = 0;
      }
    }
    expect(top / ticks).toBeGreaterThan(0.5);
    expect(maxRun).toBeGreaterThan(5);
  });
});
