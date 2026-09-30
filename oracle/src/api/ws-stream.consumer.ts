import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { AuraEventUnion } from "@aura/contracts";
import { EventStreamService } from "../orchestration/event-stream.service";
import { MarketGateway } from "./market.gateway";

/**
 * Bridges the cross-process event stream into this process's socket gateway.
 *
 * The engines live in the worker process and publish to `events:ws`; every API
 * replica runs this consumer, so a browser connected to any replica receives
 * every aura/feed/window/notification push — no matter which process produced
 * it. In a single-process deployment the in-process bus already delivered the
 * event, and the stream copy is dropped by the gateway's sequence dedupe.
 */
@Injectable()
export class WsStreamConsumer implements OnModuleInit {
  private readonly logger = new Logger(WsStreamConsumer.name);

  constructor(
    private readonly stream: EventStreamService,
    private readonly gateway: MarketGateway,
  ) {}

  onModuleInit(): void {
    this.stream.startConsuming((raw) => {
      const event = raw as AuraEventUnion | null;
      if (!event || typeof event !== "object" || !("type" in event)) return;
      this.gateway.deliver(event, `stream:${event.seq ?? 0}`);
    });
    this.logger.log("WS stream consumer started");
  }
}
