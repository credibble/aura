import { Controller, Get, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { REDIS } from "../queue/queue.constants";
import { PrismaService } from "../persistence/prisma.service";
import { queueDepths } from "../jobs/queue-depth";

type Check = { ok: boolean; detail?: string };

/**
 * Split probes:
 *  - `/health/live`  — the process is up (never touches dependencies).
 *  - `/health/ready` — every dependency this node needs answers: Postgres (when
 *    required), Redis, the indexer, and the job queues. 503 with per-check
 *    detail so a load balancer stops routing and an operator sees *what* broke.
 */
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get("live")
  live(): { status: string; ts: number } {
    return { status: "ok", ts: Date.now() };
  }

  @Get("ready")
  async ready(): Promise<{
    status: "ok" | "degraded";
    ts: number;
    checks: Record<string, Check>;
  }> {
    const [db, redis, indexer, queues] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.checkIndexer(),
      this.checkQueues(),
    ]);
    const checks = { db, redis, indexer, queues };
    const ok = Object.values(checks).every((c) => c.ok);
    const body = { status: ok ? ("ok" as const) : ("degraded" as const), ts: Date.now(), checks };
    if (!ok) throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }

  private async checkDb(): Promise<Check> {
    if (!this.prisma.required) return { ok: true, detail: "optional (DB_REQUIRED=false)" };
    return (await this.prisma.ping())
      ? { ok: true }
      : { ok: false, detail: "postgres unreachable" };
  }

  private async checkRedis(): Promise<Check> {
    try {
      const pong = await Promise.race([
        this.redis.ping(),
        new Promise<string>((r) => setTimeout(() => r("timeout"), 500)),
      ]);
      return pong === "PONG" ? { ok: true } : { ok: false, detail: `redis ${pong}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  private async checkIndexer(): Promise<Check> {
    const url =
      this.config.get<string>("INDEXER_URL") ?? "http://localhost:8080/v1/graphql";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "{ Stats_by_pk(id: \"stats\") { id } }" }),
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const json = (await res.json()) as { errors?: { message: string }[] };
      return json.errors?.length
        ? { ok: false, detail: json.errors[0]!.message }
        : { ok: true };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  private async checkQueues(): Promise<Check> {
    try {
      const depths = await queueDepths();
      const waiting = Object.values(depths).reduce((s, n) => s + n, 0);
      return { ok: true, detail: `queued=${waiting} (${JSON.stringify(depths)})` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
