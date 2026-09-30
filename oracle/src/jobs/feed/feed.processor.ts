import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Job, Queue } from "bullmq";
import { QUEUE_FEED } from "../queue.constants";
import { feedJobId } from "../queue.constants";
import { FeedEngineService } from "./feed-engine.service";
import { IndexerReader } from "../indexer/indexer-reader.service";
import type { AuraHandle } from "../jobs.types";
import { bucketSec } from "../utils";

interface FeedFanoutJob {
  now: number;
}

interface FeedRunJob {
  handle: AuraHandle;
  now: number;
}

const FEED_EVERY_MS = 10 * 60 * 1000;

/**
 * Feed worker (queue `feed`, every 10 min): fans out one job per handle and
 * drafts + broadcasts a feed post when the handle has new source data.
 */
@Processor(QUEUE_FEED, { concurrency: 4 })
@Injectable()
export class FeedProcessor extends WorkerHost {
  private readonly logger = new Logger(FeedProcessor.name);

  constructor(
    private readonly engine: FeedEngineService,
    private readonly indexer: IndexerReader,
    @InjectQueue(QUEUE_FEED) private readonly queue: Queue<FeedRunJob>,
  ) {
    super();
  }

  async process(job: Job<FeedFanoutJob | FeedRunJob>): Promise<void> {
    if (job.name === "fanout") {
      // job.data.now is the scheduler template (frozen at registration) —
      // always tick against the real wall-clock so buckets/slots stay fresh.
      await this.fanout(Date.now());
      return;
    }
    const run = job.data as FeedRunJob;
    await this.engine.run(run.handle, run.now);
  }

  private async fanout(now: number): Promise<void> {
    const handles = await this.indexer.handles();
    const bucket = bucketSec(now, FEED_EVERY_MS);
    for (const handle of handles) {
      await this.queue.add(
        "feed",
        { handle, now },
        {
          jobId: feedJobId(handle.id, bucket),
          attempts: 2,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );
    }
    this.logger.debug(`feed fanout: ${handles.length} handles (bucket ${bucket})`);
  }
}