import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../persistence/prisma.service";
import type { ITimeSeriesStore } from "../core/ports/time-series-store";
import type { MetricPoint } from "../core/domain/source";

const pointId = (sourceId: string, metric: string, timestamp: number): string =>
  `${sourceId}::${metric}::${timestamp}`;

function nearest(points: MetricPoint[], at: number): MetricPoint | null {
  if (points.length === 0) return null;
  let best = points[0]!;
  for (const p of points) {
    if (Math.abs(p.timestamp - at) < Math.abs(best.timestamp - at)) best = p;
  }
  return best;
}

/**
 * Postgres-backed time-series store for adapter-extracted metrics. One row per
 * `(sourceId, metric, timestamp)` bucket; re-inserting the same bucket
 * overwrites the value. Every point's `delta` (value vs the previous entry in
 * the series) is computed on append — so deltaListeners / deltaSales /
 * deltaStars / deltaArticles fall out of any adapter without extra work.
 * Falls back to a local map when Postgres is unreachable (dev/tests).
 */
@Injectable()
export class PrismaTimeSeriesStore implements ITimeSeriesStore {
  private readonly logger = new Logger(PrismaTimeSeriesStore.name);
  private readonly local = new Map<string, MetricPoint[]>();

  constructor(private readonly prisma: PrismaService) {}

  async append(sourceId: string, metric: string, point: MetricPoint): Promise<void> {
    const timestamp = new Date(point.timestamp);
    const delta = await this.computeDelta(sourceId, metric, point);
    const withDelta: MetricPoint = { ...point, delta: delta ?? undefined };
    try {
      await this.prisma.metricPoint.upsert({
        where: {
          sourceId_metric_timestamp: { sourceId, metric, timestamp },
        },
        create: {
          id: pointId(sourceId, metric, point.timestamp),
          sourceId,
          metric,
          value: point.value,
          delta,
          timestamp,
        },
        update: { value: point.value, delta },
      });
    } catch {
      this.appendLocal(sourceId, metric, withDelta);
    }
  }

  async appendSample(sourceId: string, points: Record<string, MetricPoint[]>): Promise<void> {
    for (const [metric, list] of Object.entries(points)) {
      for (const p of list) await this.append(sourceId, metric, p);
    }
  }

  async points(sourceId: string, metric: string, fromMs?: number, toMs?: number): Promise<MetricPoint[]> {
    try {
      const rows = await this.prisma.metricPoint.findMany({
        where: {
          sourceId,
          metric,
          timestamp: {
            gte: fromMs === undefined ? undefined : new Date(fromMs),
            lte: toMs === undefined ? undefined : new Date(toMs),
          },
        },
        orderBy: { timestamp: "asc" },
      });
      return rows.map(fromRow);
    } catch {
      return (this.local.get(localKey(sourceId, metric)) ?? []).filter(
        (p) => (fromMs === undefined || p.timestamp >= fromMs) && (toMs === undefined || p.timestamp <= toMs),
      );
    }
  }

  async latest(sourceId: string, metric: string): Promise<MetricPoint | null> {
    try {
      const row = await this.prisma.metricPoint.findFirst({
        where: { sourceId, metric },
        orderBy: { timestamp: "desc" },
      });
      return row ? fromRow(row) : null;
    } catch {
      const list = this.local.get(localKey(sourceId, metric)) ?? [];
      const last = list[list.length - 1];
      return last ?? null;
    }
  }

  async pctChange(sourceId: string, metric: string, fromMs: number, toMs: number): Promise<number | null> {
    const list = await this.allPoints(sourceId, metric);
    const a = nearest(list, fromMs);
    const b = nearest(list, toMs);
    if (!a || !b || a.timestamp === b.timestamp || a.value === 0) return null;
    return ((b.value - a.value) / a.value) * 100;
  }

  async chart(sourceId: string, metric: string, sinceMs: number, bucketMs = 5 * 60_000): Promise<MetricPoint[]> {
    const list = await this.allPoints(sourceId, metric);
    const out: MetricPoint[] = [];
    for (const p of list) {
      if (p.timestamp < sinceMs) continue;
      const t = Math.floor(p.timestamp / bucketMs) * bucketMs;
      const last = out[out.length - 1];
      if (last && last.timestamp === t) last.value = p.value;
      else out.push({ timestamp: t, value: p.value, delta: p.delta });
    }
    return out;
  }

  /** delta = value − previous entry (the last point strictly before this one). */
  private async computeDelta(sourceId: string, metric: string, point: MetricPoint): Promise<number | null> {
    const list = await this.allPoints(sourceId, metric);
    let prev: MetricPoint | null = null;
    for (const p of list) {
      if (p.timestamp < point.timestamp) prev = p;
      else if (p.timestamp === point.timestamp) continue; // same-bucket overwrite → keep prior
      else break;
    }
    return prev !== null ? point.value - prev.value : null;
  }

  private async allPoints(sourceId: string, metric: string): Promise<MetricPoint[]> {
    try {
      const rows = await this.prisma.metricPoint.findMany({
        where: { sourceId, metric },
        orderBy: { timestamp: "asc" },
      });
      return rows.map(fromRow);
    } catch {
      return this.local.get(localKey(sourceId, metric)) ?? [];
    }
  }

  private appendLocal(sourceId: string, metric: string, point: MetricPoint): void {
    const k = localKey(sourceId, metric);
    let list = this.local.get(k);
    if (!list) {
      list = [];
      this.local.set(k, list);
    }
    const last = list[list.length - 1];
    if (last && last.timestamp === point.timestamp) {
      last.value = point.value;
      last.delta = point.delta;
    } else {
      list.push(point);
      list.sort((a, b) => a.timestamp - b.timestamp);
    }
    this.logger.debug(`Postgres unavailable — series ${sourceId}::${metric} held locally`);
  }
}

const localKey = (sourceId: string, metric: string): string => `${sourceId}::${metric}`;

function fromRow(r: {
  sourceId: string;
  metric: string;
  value: number;
  delta: number | null;
  timestamp: Date;
}): MetricPoint {
  return { timestamp: r.timestamp.getTime(), value: r.value, delta: r.delta ?? undefined };
}