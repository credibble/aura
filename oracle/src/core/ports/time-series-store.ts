import type { MetricPoint } from "../domain/source";

/**
 * Time-series store for adapter-extracted metrics — the "delta / chart" data
 * the frontend and the aura index read from. Keyed `sourceId::metric`. Every
 * point carries its `delta` (value vs the previous entry in the series), so
 * downstream consumers get deltaListeners / deltaSales / deltaStars /
 * deltaArticles … for free — no manual differencing.
 */
export interface ITimeSeriesStore {
  /** Append (or update the same-bucket point for) a metric sample; computes
   *  `delta` against the previous entry. */
  append(sourceId: string, metric: string, point: MetricPoint): Promise<void>;

  /** Append a whole adapter sample (metric → points). */
  appendSample(sourceId: string, points: Record<string, MetricPoint[]>): Promise<void>;

  /** Points in a range (ascending timestamp), each with its `delta`. */
  points(sourceId: string, metric: string, fromMs?: number, toMs?: number): Promise<MetricPoint[]>;

  /** The most recent point (with its delta), or null. */
  latest(sourceId: string, metric: string): Promise<MetricPoint | null>;

  /** % change between the nearest points to [fromMs, toMs], or null. */
  pctChange(sourceId: string, metric: string, fromMs: number, toMs: number): Promise<number | null>;

  /** Bucketed series for charts (last value + delta per bucket). */
  chart(sourceId: string, metric: string, sinceMs: number, bucketMs?: number): Promise<MetricPoint[]>;
}