import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_FILLS } from "../queue.constants";
import { REDIS } from "../../queue/queue.constants";
import { SubgraphReader } from "../subgraph/subgraph-reader.service";

interface FillsJob {
  now: number;
}

const MARKER_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_LOOKBACK_MS = 30_000;

/**
 * Fills webhook watcher (queue `fills`, every 10s): reads new `OrderFill`
 * entities DIRECTLY from the subgraph GraphQL for every open window and POSTs
 * them to `WEBHOOK_URL` (`event: "order.fill"`). Nothing is mirrored into the
 * backend — the only state is a per-window Redis ts marker (TTL'd). The
 * orderbook itself is read by the frontend straight from the subgraph.
 */
@Processor(QUEUE_FILLS, { concurrency: 1 })
@Injectable()
export class FillWatchProcessor extends WorkerHost {
  private readonly logger = new Logger(FillWatchProcessor.name);
  private warnedNoWebhook = false;

  constructor(
    private readonly config: ConfigService,
    private readonly subgraph: SubgraphReader,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    super();
  }

  private get webhookUrl(): string | undefined {
    return this.config.get<string>("WEBHOOK_URL");
  }

  async process(_job: Job<FillsJob>): Promise<void> {
    const url = this.webhookUrl;
    if (!url) {
      if (!this.warnedNoWebhook) {
        this.logger.debug("WEBHOOK_URL unset — fill watcher idle.");
        this.warnedNoWebhook = true;
      }
      return;
    }
    const windows = await this.subgraph.openWindows();
    for (const win of windows) {
      try {
        await this.watchWindow(win.id, url);
      } catch (error) {
        this.logger.warn(`fills ${win.id}: ${(error as Error).message}`);
      }
    }
  }

  private markerKey(windowId: string): string {
    return `fills:last:${windowId}`;
  }

  private async watchWindow(windowId: string, url: string): Promise<void> {
    let since = Math.floor(Date.now() / 1000) - Math.floor(DEFAULT_LOOKBACK_MS / 1000);
    try {
      const raw = await this.redis.get(this.markerKey(windowId));
      if (raw) since = Number(raw);
    } catch {
      /* redis down — default lookback */
    }

    const fills = await this.subgraph.fillsSince(windowId, since);
    if (fills.length === 0) return;

    for (const fill of fills) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "order.fill", windowId, fill, ts: Date.now() }),
        signal: AbortSignal.timeout(5_000),
      }).catch((error: Error) => {
        this.logger.warn(`webhook POST failed: ${error.message}`);
        return null;
      });
      if (res && !res.ok) this.logger.warn(`webhook POST ${res.status}`);
    }

    const maxTs = Math.max(...fills.map((f) => f.ts));
    try {
      await this.redis.set(this.markerKey(windowId), String(maxTs), "EX", MARKER_TTL_SECONDS);
    } catch {
      /* redis down — next pass re-sends (at-least-once) */
    }
    this.logger.debug(`window ${windowId}: webhooked ${fills.length} fill(s)`);
  }
}
