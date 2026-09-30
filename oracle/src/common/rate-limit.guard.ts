import {
  CanActivate,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type ExecutionContext,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type Redis from "ioredis";
import { REDIS } from "../queue/queue.constants";

/**
 * Fixed-window rate limit per client IP (+ route), writes throttled harder than
 * reads. Backed by Redis `INCR`/`PEXPIRE`.
 *
 * Two deliberate properties:
 *  - **fail-open**: a Redis problem must never take the API down, so any error or
 *    a slow (>40ms) Redis round-trip lets the request through.
 *  - **no offline queue**: the shared client queues commands while disconnected,
 *    which would hang every request, so the counter is raced against a timeout.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly writeLimit: number;
  private readonly readLimit: number;
  private readonly windowMs = 60_000;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.writeLimit = config.get<number>("RATE_LIMIT_WRITES_PER_MIN") ?? 60;
    this.readLimit = config.get<number>("RATE_LIMIT_READS_PER_MIN") ?? 600;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.method === "OPTIONS") return true;

    const limit = req.method === "GET" ? this.readLimit : this.writeLimit;
    const ip = (req.ip ?? "unknown").replace(/[^0-9a-f:.]/gi, "");
    const route = (req.route?.path as string | undefined) ?? req.path.split("/").slice(0, 4).join("/");
    const key = `rl:${ip}:${req.method}:${route}`;

    const count = await this.count(key);
    if (count !== null && count > limit) {
      throw new HttpException("Too many requests — slow down", HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  /** null when Redis is unreachable/slow (caller fails open). */
  private async count(key: string): Promise<number | null> {
    try {
      const result = await Promise.race([
        (async () => {
          const n = await this.redis.incr(key);
          if (n === 1) await this.redis.pexpire(key, this.windowMs);
          return n;
        })(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 40)),
      ]);
      return result;
    } catch (e) {
      this.logger.debug(`rate limit skipped: ${(e as Error).message}`);
      return null;
    }
  }
}
