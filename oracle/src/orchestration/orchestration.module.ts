import { Module } from "@nestjs/common";
import { OracleEventBus } from "./oracle-event-bus.service";
import { EventStreamService } from "./event-stream.service";
import { OutboxService } from "./outbox.service";
import { RegistryModule } from "../registry/registry.module";
import { PersistenceModule } from "../persistence/persistence.module";

/**
 * The WS fan-out core: jobs publish to the in-process bus, which also mirrors
 * every event onto a Redis Stream so the socket gateway in ANOTHER process (the
 * API) receives it. Without the stream, worker-side events never reach browsers.
 *
 * `OutboxService` makes publishing durable: the event is recorded first, then
 * published, so a crash in between republishes instead of losing the push.
 */
@Module({
  imports: [RegistryModule, PersistenceModule],
  providers: [EventStreamService, OracleEventBus, OutboxService],
  exports: [EventStreamService, OracleEventBus, OutboxService],
})
export class OrchestrationModule {}