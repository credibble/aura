import { Module } from "@nestjs/common";
import { HandlesController } from "./handles.controller";
import { SourcesController } from "./sources.controller";
import { ConnectionsController } from "./connections.controller";
import { MarketGateway } from "./market.gateway";
import { PortfolioService } from "./portfolio.service";
import { HandleCreateService } from "./handle-create.service";
import { CleanverseService } from "./cleanverse.service";
import { OrchestrationModule } from "../orchestration/orchestration.module";
import { RegistryModule } from "../registry/registry.module";
import { AuthModule } from "../auth/auth.module";
import { SocialModule } from "../social/social.module";
import { JobsModule } from "../jobs/jobs.module";
import { CommonModule } from "../common/common.module";
import { WsStreamConsumer } from "./ws-stream.consumer";

@Module({
  imports: [
    CommonModule,
    OrchestrationModule,
    RegistryModule,
    AuthModule,
    SocialModule,
    JobsModule,
  ],
  controllers: [HandlesController, SourcesController, ConnectionsController],
  providers: [MarketGateway, WsStreamConsumer, PortfolioService, CleanverseService, HandleCreateService],
})
export class ApiModule {}