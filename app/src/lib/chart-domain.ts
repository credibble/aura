/**
 * Green when the series is rising, red when it is falling — the SAME colour the
 * number next to the chart uses. Pass `change` (the % or points already shown in
 * the UI) whenever you have it, so the line can never disagree with its label;
 * otherwise it derives from first→last.
 */
export function trendColor(data: number[], change?: number): string {
  const first = data[0];
  const last = data[data.length - 1];
  const rising =
    typeof change === "number" && Number.isFinite(change)
      ? change >= 0
      : (last ?? 0) >= (first ?? 0);
  return rising ? "hsl(var(--up))" : "hsl(var(--down))";
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
