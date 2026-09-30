import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Inject, Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_NOTIFY } from "../queue.constants";
import { REDIS } from "../../queue/queue.constants";
import { SubgraphReader } from "../subgraph/subgraph-reader.service";
import { SocialService } from "../../social/social.service";
import { PrismaService } from "../../persistence/prisma.service";
import type { AuraHandle } from "../jobs.types";

interface NotifyJob {
  now: number;
}

const MARKER_TTL_SECONDS = 7 * 24 * 60 * 60;
const BATCH_LIMIT = 10;

/**
 * Notification worker (queue `notify`, every 30s): for each handle it scans the
 * Post table for NEW posts since the last pass (Redis marker) and writes ONE
 * notification row per (post × follower∪subscriber). `SocialService.notify`
 * also publishes `notification.pushed`, which the MarketGateway routes to that
 * user's authenticated sockets only.
 */
@Processor(QUEUE_NOTIFY, { concurrency: 1 })
@Injectable()
export class NotifyProcessor extends WorkerHost {
  private readonly logger = new Logger(NotifyProcessor.name);

  constructor(
    private readonly subgraph: SubgraphReader,
    private readonly social: SocialService,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    super();
  }

  async process(_job: Job<NotifyJob>): Promise<void> {
    const now = Date.now();
    const handles = await this.subgraph.handles();
    for (const handle of handles) {
      try {
        await this.notifyHandle(handle, now);
      } catch (error) {
        this.logger.warn(`notify @${handle.label}: ${(error as Error).message}`);
      }
    }
  }

  private markerKey(label: string): string {
    return `notify:last:${label}`;
  }

  private async notifyHandle(handle: AuraHandle, now: number): Promise<void> {
    let last = now - 60_000;
    try {
      const raw = await this.redis.get(this.markerKey(handle.label));
      if (raw) last = Number(raw);
    } catch {
      /* redis down — default window */
    }

    const posts = await this.prisma.post.findMany({
      where: { handleId: handle.id, ts: { gt: new Date(last) } },
      orderBy: { ts: "desc" },
      take: BATCH_LIMIT,
    });
    if (posts.length === 0) return;

    const kind = "post";
    // Union first so each user gets ONE row (and one live push) per post —
    // notify() publishes `notification.pushed` itself, no manual fan-out here.
    const followerIds = await this.social.followers(handle.id);
    const subscriberIds = await this.social.subscribersOf(handle.id);
    const userIds = [...new Set([...followerIds, ...subscriberIds])];
    for (const post of posts) {
      const title = `@${handle.label} posted`;
      const body = post.summary;
      for (const userId of userIds) {
        await this.social.notify(userId, kind, title, body, { postId: post.id });
      }
    }

    try {
      await this.redis.set(this.markerKey(handle.label), String(now), "EX", MARKER_TTL_SECONDS);
    } catch {
      /* redis down — next pass re-runs */
    }
    this.logger.debug(`@${handle.label}: notified ${posts.length} new post(s) → ${userIds.length} user(s)`);
  }
}
