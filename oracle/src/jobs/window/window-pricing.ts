/**
 * Window pricing model — how a market's STRIKE and its INITIAL PROBABILITIES are
 * chosen. Replaces the old hard-coded 50/50 seed, which threw away everything the
 * handle's own aura history says about the window ahead of it.
 *
 * THE MODEL
 * ---------
 * A window asks one thing: will the handle's aura at `windowEnd` be at or above
 * the level it had at `windowStart`? Call that level the STRIKE, and note it is a
 * *random-walk threshold set at open* — the honest definition of "rise above X"
 * when X is where the index actually is.
 *
 * The aura series is treated as a drifting random walk in **relative** terms:
 * each step's log-return `r_i = ln(a_i / a_{i-1})`. From the recent window of
 * observations we estimate
 *
 *     μ = mean(r_i)            per-step drift
 *     σ = stdev(r_i)           per-step volatility (sample stdev)
 *
 * and scale them to the market's horizon T (the number of series steps the window
 * spans, floored at 1):
 *
 *     μ_T = μ · T              σ_T = σ · √T
 *
 * For a Gaussian walk the probability of finishing at or above the strike is
 *
 *     p = P(S_T ≥ S_0) = Φ( μ_T / σ_T ) = Φ( (μ/σ) · √T )
 *
 * i.e. only the **risk-adjusted drift** `μ/σ` and the horizon matter — a series
 * that climbs steadily prices above 50%, a choppy one prices near it, and a
 * falling one below. Φ is the standard normal CDF.
 *
 * Guard rails (all deliberate):
 *  - fewer than 3 points, non-positive prices, or σ = 0 → the market is
 *    uninformative, so it seeds 50/50 rather than inventing an edge;
 *  - `p` is clamped to [0.02, 0.98]: the contract rejects a zero or unity leg, and
 *    a near-certain book has no two-sided trading;
 *  - probabilities are emitted as exact 1e18 integers that sum to 1e18 (the second
 *    leg is the complement, so rounding can never break the sum).
 */

/** Kept here (not imported) so this file stays dependency-free and testable. */
export const ONE = 10n ** 18n;

const MIN_POINTS = 3;
const MIN_PROB = 0.02;
const MAX_PROB = 0.98;

/** Abramowitz & Stegun 7.1.26 erf approximation (|ε| ≤ 1.5e-7) — plenty for pricing. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-z * z));
}

/** Standard normal CDF. */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export type PriorInput = {
  /** The handle's aura series, oldest → newest (1e2 units, e.g. 3040 = 30.40). */
  points: number[];
  /** Window length in seconds. */
  windowSec: number;
  /** Median seconds between series points (the series' own cadence). */
  stepSec: number;
};

export type WindowPriors = {
  /** YES wins iff the aura closes at or above this level (the open level). */
  strike: number;
  /** 1e18-scaled probabilities, `[pYes, pNo]`, summing to exactly 1e18. */
  probabilities: [string, string];
  /** Diagnostics for the log — never used to trade. */
  model: { pYes: number; drift: number; vol: number; steps: number; fallback: boolean };
};

/** The open level that becomes the question's strike. */
export function strikeFor(points: number[], onChainAura: number): number {
  const last = points[points.length - 1];
  return typeof last === "number" && Number.isFinite(last) && last > 0 ? last : onChainAura;
}

/**
 * Probability that the aura closes at or above the strike, and the 1e18 pair the
 * LMSR is seeded with.
 */
export function windowPriors({
  points,
  windowSec,
  stepSec,
}: PriorInput): WindowPriors {
  const strike = points[points.length - 1] ?? 0;
  const flat: WindowPriors = {
    strike,
    probabilities: ["500000000000000000", "500000000000000000"],
    model: { pYes: 0.5, drift: 0, vol: 0, steps: 0, fallback: true },
  };
  if (points.length < MIN_POINTS) return flat;

  // Log-returns over the observed series.
  const returns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (prev > 0 && cur > 0) returns.push(Math.log(cur / prev));
  }
  if (returns.length < MIN_POINTS - 1) return flat;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) * (r - mean), 0) / Math.max(1, returns.length - 1);
  const vol = Math.sqrt(variance);
  // A flat series carries no information — don't manufacture an edge from noise.
  if (!Number.isFinite(vol) || vol <= 0) return flat;

  // Horizon in series steps: how many of the series' own intervals fit in the
  // window. A 30-minute series step with a 1-hour window is 2 steps.
  const steps = Math.max(1, Math.round(windowSec / Math.max(1, stepSec)));
  const z = (mean / vol) * Math.sqrt(steps);
  const pYes = Math.min(MAX_PROB, Math.max(MIN_PROB, normalCdf(z)));

  const p1e18 = (p: number): bigint => {
    const scaled = BigInt(Math.round(p * 1e12)) * (ONE / 10n ** 12n);
    return scaled;
  };
  const yes = p1e18(pYes);
  return {
    strike,
    probabilities: [yes.toString(), (ONE - yes).toString()],
    model: { pYes, drift: mean, vol, steps, fallback: false },
  };
}

/** Median seconds between consecutive timestamps of a series (the cadence). */
export function stepSeconds(timestampsSec: number[]): number {
  if (timestampsSec.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < timestampsSec.length; i++) {
    const gap = timestampsSec[i]! - timestampsSec[i - 1]!;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}
