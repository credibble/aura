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
