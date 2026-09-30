import { Module, forwardRef } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { RegistryModule } from "../registry/registry.module";
import { QUEUE_AURA, QUEUE_FEED, QUEUE_WINDOW, QUEUE_NOTIFY, QUEUE_FILLS } from "./queue.constants";
import { JobsScheduler } from "./jobs-scheduler.service";
import { AuraProcessor } from "./aura/aura.processor";
import { AuraEngineService } from "./aura/aura-engine.service";
import { FeedProcessor } from "./feed/feed.processor";
import { FeedEngineService } from "./feed/feed-engine.service";
import { FeedAiService } from "./feed/feed-ai.service";
import { WindowProcessor } from "./window/window.processor";
import { WindowEngineService } from "./window/window-engine.service";
import { NotifyProcessor } from "./notify/notify.processor";
import { FillWatchProcessor } from "./fills/fill-watch.processor";
import { SubgraphReader } from "./subgraph/subgraph-reader.service";
import { SourceCacheService } from "./source-cache/source-cache.service";
import { ChainGateway } from "./chain/chain-gateway.service";
import { WsBroadcastService } from "./ws/ws-broadcast.service";
import { StructuredAiService } from "./ai/structured-ai.service";
import { AdaptersModule } from "../adapters/adapters.module";
import { IngestionModule } from "../ingestion/ingestion.module";
import { OrchestrationModule } from "../orchestration/orchestration.module";
import { AiModule } from "../ai/ai.module";
import { SocialModule } from "../social/social.module";

/**
 * The job-oriented oracle core: four BullMQ queues (`aura`, `feed`, `window`,
 * `notify`) with repeatable schedulers + concurrent workers, a Redis source
 * cache with TTL shared across departments, the viem chain gateway
 * (subgraph-backed) and WS fan-out through the existing OracleEventBus →
 * MarketGateway (notifications route to per-user sockets).
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_AURA }, { name: QUEUE_FEED }, { name: QUEUE_WINDOW }, { name: QUEUE_NOTIFY }, { name: QUEUE_FILLS }),
    AdaptersModule,
    IngestionModule,
    RegistryModule,
OrchestrationModule,
    AiModule,
    forwardRef(() => SocialModule),
  ],
  providers: [
    JobsScheduler,
    AuraProcessor,
    AuraEngineService,
    FeedProcessor,
    FeedEngineService,
    FeedAiService,
    WindowProcessor,
    WindowEngineService,
NotifyProcessor,
    FillWatchProcessor,
    SubgraphReader,
    SourceCacheService,
    ChainGateway,
    WsBroadcastService,
    StructuredAiService,
  ],
  exports: [
    SubgraphReader,
    SourceCacheService,
    ChainGateway,
    WsBroadcastService,
    StructuredAiService,
    AuraEngineService,
    FeedEngineService,
    WindowEngineService,
  ],
})
export class JobsModule {}

export { QUEUE_AURA, QUEUE_FEED, QUEUE_WINDOW, QUEUE_NOTIFY, QUEUE_FILLS } from "./queue.constants";
export { auraJobId, feedJobId, windowJobId } from "./queue.constants";