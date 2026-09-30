import { Global, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { RedisModule } from "./redis.module";

/**
 * BullMQ root connection + the shared ioredis client. Queues are registered by
 * the consumers (JobsModule registers aura/feed/window; the API can add more).
 */
@Global()
@Module({
  imports: [
    RedisModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger("BullMQ");
        const url = config.get<string>("REDIS_URL") ?? "redis://localhost:6379";
        logger.log(`BullMQ connecting to ${url}`);
        return { connection: { url } };
      },
    }),
  ],
})
export class QueueModule {}