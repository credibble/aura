import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly required: boolean;

  constructor(config: ConfigService) {
    super();
    const nodeEnv = config.get<string>("NODE_ENV");
    const dbRequired = config.get<boolean>("DB_REQUIRED");
    this.required = dbRequired ?? nodeEnv === "production";
  }

  async onModuleInit(): Promise<void> {
    if (!this.required) {
      this.logger.warn(
        "Persistence started WITHOUT a required database (DB_REQUIRED=false) — " +
          "reads will degrade to empty instead of failing.",
      );
      return;
    }
    await this.$connect();
    this.logger.log("Connected to Postgres");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run a database operation with a loud failure mode.
   *
   * When the database is REQUIRED (production), an outage must surface as an
   * error — never as "no rows" — so callers get a 503 and metrics/alerts fire.
   * In development (DB_REQUIRED=false) the `fallback` keeps the API usable with
   * a warning, which is the only place silent degradation is allowed.
   */
  async guard<T>(op: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const message = `${op} failed: ${(error as Error).message}`;
      if (this.required) {
        this.logger.error(message);
        throw new ServiceUnavailableError(message);
      }
      this.logger.warn(`${message} (degrading to fallback)`);
      return fallback;
    }
  }

  /** Liveness probe for /health/ready — true when a trivial query answers. */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

/** Narrow error type so callers/filters can map it to HTTP 503 without importing Nest here. */
export class ServiceUnavailableError extends Error {
  readonly status = 503;
  constructor(message: string) {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}
