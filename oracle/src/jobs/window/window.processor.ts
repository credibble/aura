import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Job, Queue } from "bullmq";
import { QUEUE_WINDOW } from "../queue.constants";
import { windowJobId } from "../queue.constants";
import { slotBounds } from "@aura/contracts";
import { WindowEngineService } from "./window-engine.service";
import { IndexerReader } from "../indexer/indexer-reader.service";
import type { AuraHandle } from "../jobs.types";

interface WindowFanoutJob {
  now: number;
}

interface WindowTickJob {
  handle: AuraHandle;
  now: number;
}

/**
 * Market-maker window worker (queue `window`, every 5s): fans out one job per
 * GRADUATED handle, keyed by the current slot (`window:<handleId>:<startSec>`),
 * which opens the slot's window and settles any expired open windows.
 */
@Processor(QUEUE_WINDOW, { concurrency: 2 })
@Injectable()
export class WindowProcessor extends WorkerHost {
  private readonly logger = new Logger(WindowProcessor.name);

  constructor(
    private readonly engine: WindowEngineService,
    private readonly indexer: IndexerReader,
    @InjectQueue(QUEUE_WINDOW) private readonly queue: Queue<WindowTickJob>,
  ) {
    super();
  }

  async process(job: Job<WindowFanoutJob | WindowTickJob>): Promise<void> {
    if (job.name === "fanout") {
      // job.data.now is the scheduler template (frozen at registration) —
      // always tick against the real wall-clock so buckets/slots stay fresh.
      await this.fanout(Date.now());
      return;
    }
    const tick = job.data as WindowTickJob;
    await this.engine.tick(tick.handle, tick.now);
  }

  private async fanout(now: number): Promise<void> {
    const handles = await this.indexer.graduatedHandles();
    for (const handle of handles) {
      const { start } = slotBounds(now, handle.windowMinutes);
      const startSec = Math.floor(start / 1000);
      await this.queue.add(
        "window",
        { handle, now },
        {
          jobId: windowJobId(handle.id, startSec),
          attempts: 6,
          backoff: { type: "exponential", delay: 3000 },
          removeOnComplete: 200,
          removeOnFail: 0,
        },
      );
    }
    this.logger.debug(`window fanout: ${handles.length} graduated handles`);
  }
}