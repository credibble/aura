import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../persistence/prisma.service";
import { OracleEventBus } from "./oracle-event-bus.service";

/**
 * Transactional outbox (at-least-once).
 *
 * `emit(type, payload)` records the event, then publishes it immediately through
 * the bus (which mirrors it onto the WS stream). If the process dies between the
 * business write and the publish, the drainer picks the row up on the next tick —
 * a lost push becomes a late push.
 *
 * Delivery is deliberately **at-least-once**: the row is marked published AFTER
 * a successful publish, so a crash mid-flight republishes rather than drops.
 * Duplicate socket messages are harmless (they only invalidate a query).
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private readonly intervalMs: number;
  private readonly batch: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: OracleEventBus,
    config: ConfigService,
  ) {
    this.intervalMs = config.get<number>("OUTBOX_DRAIN_MS") ?? 750;
    this.batch = config.get<number>("OUTBOX_BATCH") ?? 100;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.drain(), this.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Record + publish. Never throws: on a DB failure we publish directly so the
   * live path keeps working (durability is the only thing lost).
   */
  emit(type: string, payload: unknown): void {
    void (async () => {
      let id: string | null = null;
      try {
        const row = await this.prisma.outboxEvent.create({
          data: { type, payload: payload as never },
          select: { id: true },
        });
        id = row.id;
      } catch (e) {
        this.logger.warn(`outbox record failed (${type}): ${(e as Error).message}`);
      }
      try {
        this.bus.publish({ v: 1, source: "oracle", type, ts: Date.now(), seq: 0, data: payload } as never);
        if (id) await this.markPublished(id);
      } catch (e) {
        if (id) await this.markFailed(id, e);
      }
    })();
  }

  /** Publish anything still unpublished (retries, crash recovery). */
  async drain(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    let published = 0;
    try {
      const rows = await this.prisma.outboxEvent.findMany({
        where: { publishedAt: null },
        orderBy: { createdAt: "asc" },
        take: this.batch,
      });
      for (const row of rows) {
        try {
          this.bus.publish({
            v: 1,
            source: "oracle",
            type: row.type,
            ts: Date.now(),
            seq: 0,
            data: row.payload as never,
          } as never);
          await this.markPublished(row.id);
          published += 1;
        } catch (e) {
          await this.markFailed(row.id, e);
        }
      }
      if (published > 0) this.logger.debug(`outbox drained ${published} event(s)`);
    } catch {
      /* DB unavailable — try again next tick */
    } finally {
      this.draining = false;
    }
    return published;
  }

  private async markPublished(id: string): Promise<void> {
    await this.prisma.outboxEvent
      .update({ where: { id }, data: { publishedAt: new Date() } })
      .catch(() => {});
  }

  private async markFailed(id: string, error: unknown): Promise<void> {
    await this.prisma.outboxEvent
      .update({
        where: { id },
        data: { attempts: { increment: 1 }, lastError: (error as Error).message.slice(0, 300) },
      })
      .catch(() => {});
  }
}
