import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { QUEUE_AURA } from "../queue.constants";
import { AuraEngineService } from "./aura-engine.service";
import { WindowEngineService } from "../window/window-engine.service";
import { IndexerReader } from "../indexer/indexer-reader.service";
import type { Queue } from "bullmq";
import { InjectQueue } from "@nestjs/bullmq";
import { auraJobId } from "../queue.constants";
import type { AuraHandle } from "../jobs.types";
import { bucketSec } from "../utils";

interface AuraFanoutJob {
  now: number;
}

interface AuraTickJob {
  handle: AuraHandle;
  now: number;
}

const AURA_EVERY_MS = 10_000;

/**
 * Aura worker (queue `aura`):
 *  - `fanout` jobs (one per 10s bucket) resolve handles from the indexer and
 *    enqueue one tick per handle with a deterministic jobId
 *    `aura:<handleId>:<bucket>` — deduped within the bucket, so restarts can
 *    never double-process;
 *  - `aura` jobs run the engine with a concurrency of 1: KIMI allows a single
 *    in-flight request per organisation, so more workers only produce 429s.
 */
@Processor(QUEUE_AURA, { concurrency: 1 })
@Injectable()
export class AuraProcessor extends WorkerHost {
  private readonly logger = new Logger(AuraProcessor.name);

  constructor(
    private readonly engine: AuraEngineService,
    private readonly windows: WindowEngineService,
    private readonly indexer: IndexerReader,
    @InjectQueue(QUEUE_AURA) private readonly queue: Queue<AuraTickJob>,
  ) {
    super();
  }

  async process(job: Job<AuraFanoutJob | AuraTickJob>): Promise<void> {
    if (job.name === "fanout") {
      // job.data.now is the scheduler template (frozen at registration) —
      // always tick against the real wall-clock so buckets/slots stay fresh.
      await this.fanout(Date.now());
      return;
    }
    const tick = job.data as AuraTickJob;
    // The tick is now public on-chain (Handle.updateAura) and over WS. If this
    // handle has a live window, that observation is its close: settle early so
    // the market freezes before anyone can buy the now-known winner below par.
    const aura = await this.engine.compute(tick.handle, tick.now);
    if (aura) {
      await this.windows.settleOnObservation(tick.handle, aura.aura, tick.now);
    }
  }

  private async fanout(now: number): Promise<void> {
    const handles = await this.indexer.handles();
    const bucket = bucketSec(now, AURA_EVERY_MS);
    for (const handle of handles) {
      await this.queue.add(
        "aura",
        { handle, now },
        {
          jobId: auraJobId(handle.id, bucket),
          attempts: 2,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
    }
    this.logger.debug(`aura fanout: ${handles.length} handles (bucket ${bucket})`);
  }
}