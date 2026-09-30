import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import { redisReachable } from "../persistence/reachability";
import { QUEUE_AURA, QUEUE_FEED, QUEUE_WINDOW, QUEUE_NOTIFY, QUEUE_FILLS } from "./queue.constants";
import { SCHEDULER_AURA, SCHEDULER_FEED, SCHEDULER_WINDOW, SCHEDULER_NOTIFY, SCHEDULER_FILLS } from "./queue.constants";

const AURA_EVERY_MS = 10_000;
const FEED_EVERY_MS = 10 * 60 * 1000;
const NOTIFY_EVERY_MS = 30_000;
const FILLS_EVERY_MS = 10_000;
const RETRY_MS = 10_000;

/**
 * Registers the four repeatable job schedulers (idempotent via BullMQ job
 * schedulers):
 *   - aura   every 10s — per-handle aura ticks (concurrent)
 *   - feed   every 10m — per-handle AI feed posts
 *   - window every WINDOW_EVERY_MS (default 5s) — per-graduated-handle
 *            open/settle
 *   - notify every 30s — follower notifications + subscriber WS pushes
 * Each scheduler enqueues a `fanout` job; the workers resolve handles from the
 * indexer and enqueue idempotent per-handle jobs. Gated on Redis so the API
 * boots without the broker and self-heals once Redis returns.
 */
@Injectable()
export class JobsScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsScheduler.name);
  private registered = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_AURA) private readonly aura: Queue,
    @InjectQueue(QUEUE_FEED) private readonly feed: Queue,
    @InjectQueue(QUEUE_WINDOW) private readonly window: Queue,
    @InjectQueue(QUEUE_NOTIFY) private readonly notify: Queue,
    @InjectQueue(QUEUE_FILLS) private readonly fills: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.tryRegister();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tryRegister(): Promise<void> {
    if (!this.config.get<boolean>("JOBS_ENABLED")) {
      this.logger.log("Job schedulers disabled (JOBS_ENABLED=false)");
      return;
    }
    const url = this.config.get<string>("REDIS_URL") ?? "redis://localhost:6379";
    if (!(await redisReachable(url))) {
      this.logger.warn("Redis unreachable — job schedulers deferred.");
      this.scheduleRetry();
      return;
    }
    try {
      const windowEveryMs = this.config.get<number>("WINDOW_EVERY_MS") ?? 5_000;
      await this.aura.upsertJobScheduler(SCHEDULER_AURA, { every: AURA_EVERY_MS }, { name: "fanout", data: { now: Date.now() } });
      await this.feed.upsertJobScheduler(SCHEDULER_FEED, { every: FEED_EVERY_MS }, { name: "fanout", data: { now: Date.now() } });
      await this.window.upsertJobScheduler(SCHEDULER_WINDOW, { every: windowEveryMs }, { name: "fanout", data: { now: Date.now() } });
      await this.notify.upsertJobScheduler(SCHEDULER_NOTIFY, { every: NOTIFY_EVERY_MS }, { name: "fanout", data: { now: Date.now() } });
      await this.fills.upsertJobScheduler(SCHEDULER_FILLS, { every: FILLS_EVERY_MS }, { name: "fanout", data: { now: Date.now() } });
      this.registered = true;
      this.logger.log(
        `Job schedulers registered: aura ${AURA_EVERY_MS}ms, feed ${FEED_EVERY_MS}ms, window ${windowEveryMs}ms, notify ${NOTIFY_EVERY_MS}ms, fills ${FILLS_EVERY_MS}ms`,
      );
    } catch (error) {
      this.logger.warn(`Job scheduler registration failed (${(error as Error).message}) — retrying.`);
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.registered || this.timer) return;
    this.timer = setInterval(() => {
      void this.tryRegister().catch((e) => this.logger.warn(e));
    }, RETRY_MS);
    this.timer.unref?.();
  }
}