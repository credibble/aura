/** One day in ms — the standard lookback every chart's colour is measured over. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** A timestamped sample: the series oldest → newest. */
export type TrendPoint = { ts: number; v: number };

const UP = "hsl(var(--up))";
const DOWN = "hsl(var(--down))";

/**
 * Green when the series is rising, red when it is falling — the SAME colour the
 * number next to the chart uses. Pass `change` (the % or points already shown in
 * the UI) whenever you have it, so the line can never disagree with its label;
 * otherwise it derives from first→last. Use this for value-only series (a card
 * whose displayed % is a single tick); when the samples carry timestamps, prefer
 * `trendColorFrom`, which measures over the last 24h.
 */
export function trendColor(data: number[], change?: number): string {
  const first = data[0];
  const last = data[data.length - 1];
  const rising =
    typeof change === "number" && Number.isFinite(change)
      ? change >= 0
      : (last ?? 0) >= (first ?? 0);
  return rising ? UP : DOWN;
}

/**
 * The change a chart's colour is drawn from: the move over the last 24h when the
 * series reaches back that far, otherwise the whole series (start → end). A
 * chart is read like a market — green when the value is UP over the day, red
 * when it is down — so the colour is anchored to the day, NOT to whichever range
 * chip happens to be selected. Pass `change` when the UI already shows the
 * number, so the line can never disagree with its label; it wins outright.
 *
 * `points` must be oldest → newest. A series with no usable timestamps degrades
 * to the whole-series change, exactly like `trendColor`.
 */
export function trendChange(points: TrendPoint[], change?: number): number {
  if (typeof change === "number" && Number.isFinite(change)) return change;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 0;
  if (last.ts - first.ts > DAY_MS) {
    // Baseline = the last sample at (or just before) the 24h mark; `first`
    // always qualifies, so the loop can never leave `base` unset.
    const cutoff = last.ts - DAY_MS;
    let base = first;
    for (const p of points) {
      if (p.ts > cutoff) break;
      base = p;
    }
    return last.v - base.v;
  }
  return last.v - first.v;
}

/** Green when the 24h (else whole-series) change is non-negative, else red. */
export function trendColorFrom(points: TrendPoint[], change?: number): string {
  return trendChange(points, change) >= 0 ? UP : DOWN;
}

/**
 * Chart domain helper. Charts must read at any scale: a series that moves 0.01
 * over an hour should look like movement, and a series that genuinely doesn't
 * move should sit centred instead of being pinned to the floor.
 *
 * - Non-flat series: the data's own min/max, with a little headroom so the
 *   extremes breathe. Amplitude is already relative, so a 3-cent move fills the
 *   chart exactly like a 30-point one.
 * - Flat series: a hairline domain around the value, so the line renders in the
 *   middle of the plot area rather than hugging the bottom edge.
 */
export function tightDomain(data: number[]): { min: number; max: number } {
  if (data.length === 0) return { min: 0, max: 1 };
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  if (hi === lo) {
    const pad = Math.abs(hi) * 0.002 || 1;
    return { min: hi - pad, max: hi + pad };
  }
  const pad = (hi - lo) * 0.08;
  return { min: lo - pad, max: hi + pad };
}

/**
 * A domain CENTRED on `strike`, so the strike line renders at the exact middle
 * of the plot. Used by the aura lens, whose question is "above or below the
 * strike": a line at mid-height reads as the split, and a domain symmetric about
 * it keeps the whole series inside the frame.
 *
 *   half = max(|max − strike|, |strike − min|) × 1.08
 *   min  = strike − half,  max = strike + half
 *
 * The 1.08 mirrors `tightDomain`'s 8% headroom so the series' extremes don't
 * touch the edge; the flat-series fallback (0.2% of the strike) mirrors its
 * hairline. A domain symmetric about the strike is also exactly what makes the
 * mapped strike land at half the plot height.
 */
export function strikeCenteredDomain(
  data: number[],
  strike: number,
): { min: number; max: number } {
  const halfRaw = data.length ? Math.max(...data.map((v) => Math.abs(v - strike))) : 0;
  const half = halfRaw > 0 ? halfRaw * 1.08 : Math.abs(strike) * 0.002 || 1;
  return { min: strike - half, max: strike + half };
}

/**
 * The domain for a probability axis: the whole 0–100% space, extended only if a
 * real value falls outside it.
 *
 * Outcome prices are shares of a whole, so they must be read against the fixed
 * percentage scale — a 0.4-point move is 0.4% of the plot. `tightDomain` is
 * deliberately the WRONG tool here: on a binary market the two outcomes are
 * complements, so a 50/50 window's data band is ~0.7 points and the band
 * magnifies that 0.4-point move to nearly the full height, while a lopsided
 * window's band spans the legs. The band is always arbitrary; the percent space
 * is not.
 */
export function percentDomain(data: number[]): { min: number; max: number } {
  if (data.length === 0) return { min: 0, max: 100 };
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  return { min: Math.min(0, lo), max: Math.max(100, hi) };
}
