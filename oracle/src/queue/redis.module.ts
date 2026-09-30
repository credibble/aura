import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import Redis from "ioredis";
import { REDIS } from "./queue.constants";

/**
 * Shared ioredis instance for the oracle (dedup, pub/sub). BullMQ manages its
 * own connection internally; this one is for our direct needs. Tolerant of a
 * down Redis so the API still boots in development.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (config: ConfigService): Redis => {
        const logger = new Logger("Redis");
        const url = config.get<string>("REDIS_URL") ?? "redis://localhost:6379";
        const client = new Redis(url, {
          maxRetriesPerRequest: null,
          retryStrategy: (times) => Math.min(times * 500, 5000),
          lazyConnect: true,
        });
        client.on("error", (err) => logger.warn(`Redis unavailable: ${err.message}`));
        client.on("connect", () => logger.log("Redis connected"));
        void client.connect().catch(() => {
          /* lazy — reconnect handled by ioredis */
        });
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}