/** Shared API fetch helpers for adapters. */

export async function apiGetJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as unknown;
}

/** Bucket `now` down to the start of a window (5m buckets by default). */
export function bucketStart(now: number, bucketMs = 5 * 60_000): number {
  return Math.floor(now / bucketMs) * bucketMs;
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Sum a numeric field across an array (e.g. order totals). */
export function sum<T>(rows: readonly T[], pick: (row: T) => number): number {
  return rows.reduce((acc, r) => acc + (pick(r) || 0), 0);
}