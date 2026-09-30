import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter } from "node:events";
import type { AuraEventUnion } from "@aura/contracts";
import { EventStreamService } from "./event-stream.service";

/**
 * Typed event bus, two-layered:
 *
 *   1. **in-process** `EventEmitter` — instant fan-out for whatever lives in this
 *      process (and the only path needed in single-process development);
 *   2. **Redis Stream** — cross-process fan-out so a worker's events reach every
 *      API replica's socket gateway.
 *
 * Publishing never throws: a dead Redis degrades to "this process only".
 */
@Injectable()
export class OracleEventBus {
  private readonly emitter = new EventEmitter();
  private readonly logger = new Logger(OracleEventBus.name);
  private seq = 0;

  constructor(private readonly stream?: EventStreamService) {}

  publish(event: AuraEventUnion): void {
    this.seq += 1;
    const stamped = { ...event, seq: this.seq };
    this.emitter.emit("event", stamped);
    void this.stream?.publish(stamped);
    this.logger.debug(`[${stamped.type}] @${(stamped.data as { handleId?: string })?.handleId ?? ""}`);
  }

  subscribe(handler: (event: AuraEventUnion) => void): () => void {
    this.emitter.on("event", handler);
    return () => this.emitter.off("event", handler);
  }
}
