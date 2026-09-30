import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { configuration } from "./config/configuration";
import { validateEnv } from "./config/env";
import { HealthModule } from "./health/health.module";
import { PersistenceModule } from "./persistence/persistence.module";
import { RegistryModule } from "./registry/registry.module";
import { IngestionModule } from "./ingestion/ingestion.module";
import { AiModule } from "./ai/ai.module";
import { OrchestrationModule } from "./orchestration/orchestration.module";
import { QueueModule } from "./queue/queue.module";
import { ApiModule } from "./api/api.module";
import { JobsModule } from "./jobs/jobs.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    QueueModule,
    PersistenceModule,
    RegistryModule,
    IngestionModule,
    AiModule,
    OrchestrationModule,
    ApiModule,
    HealthModule,
    JobsModule,
  ],
})
export class AppModule {}