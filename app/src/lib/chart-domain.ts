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
