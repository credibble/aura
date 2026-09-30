/** Shared numeric/sequence helpers for the job engines (pure — unit-tested). */

/** Right-pad a series to length `n` by repeating the last value. Used for the
 *  N-point history rule: a brand-new source (1 data point) is repeated N times
 *  so the AI sees a steady baseline and aura never spikes on a fresh source. */
export function padToN(values: number[], n: number): number[] {
  if (values.length >= n) return values.slice(-n);
  if (values.length === 0) return [];
  const out = [...values];
  while (out.length < n) out.push(out[out.length - 1] ?? 0);
  return out;
}

/** Clamp + round to a safe integer range. */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Bucket a unix-ms timestamp to the scheduler interval (seconds). */
export function bucketSec(nowMs: number, intervalMs: number): number {
  return Math.floor(nowMs / intervalMs);
}