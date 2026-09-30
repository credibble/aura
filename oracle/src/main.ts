import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import { AppModule } from "./app.module";
import { corsOptions, securityHeaders } from "./common/http-hardening";

async function bootstrap(): Promise<void> {
  const nodeEnv = process.env.NODE_ENV;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: corsOptions(process.env.CORS_ORIGINS, nodeEnv),
  });

  // Behind a proxy/load balancer the client IP comes from X-Forwarded-For — the
  // rate limiter needs it, and it must not be trusted blindly.
  app.set("trust proxy", 1);

  app.use(securityHeaders());
  // JSON bodies are small by design (posts carry text, media goes to Cloudinary).
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));

  // Body validation is per-endpoint via ZodBodyPipe (zod is already a dep);
  // Nest's class-based ValidationPipe needs class-validator, which isn't installed.

  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`Oracle listening on http://localhost:${port}`, "Bootstrap");
}

void bootstrap();
