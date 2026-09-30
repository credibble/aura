import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";

/**
 * Dedicated worker entrypoint — deploy N of these to scale ingestion,
 * sentiment and window-tick processing independently of the API. Shares the
 * same BullMQ queues via Redis, so any worker can pick up any job.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["log", "warn", "error"] });
  app.enableShutdownHooks();
  Logger.log("Oracle workers started", "Worker");
}

void bootstrap();