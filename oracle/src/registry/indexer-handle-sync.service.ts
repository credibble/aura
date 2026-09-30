import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Inject } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS } from "../queue/queue.constants";
import type { OnChainHandleView } from "../core/domain/handle";

const CACHE_KEY = "oracle:handles:v1";

/**
 * The oracle's source of truth for handles is ON-CHAIN: handles are created via
 * the HandleFactory, indexed by the Envio indexer, and read here through its
 * GraphQL endpoint, then cached in Redis (with an in-memory mirror for when
 * either is unavailable). There is NO handle seeding in the backend.
 */
@Injectable()
export class IndexerHandleSync implements OnModuleInit {
  private readonly logger = new Logger(IndexerHandleSync.name);
  private cached: OnChainHandleView[] = [];

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    const intervalMs = this.config.get<number>("INDEXER_CACHE_TTL_MS") ?? 60_000;
    setInterval(() => void this.refresh(), intervalMs);
  }

  async handles(): Promise<OnChainHandleView[]> {
    if (this.cached.length > 0) return this.cached;
    try {
      const raw = await this.redis.get(CACHE_KEY);
      if (raw) this.cached = parseHandles(raw);
    } catch {
      /* redis down — keep in-memory mirror */
    }
    return this.cached;
  }

  /** Pull the Handle entities from the indexer and warm the Redis cache. */
  async refresh(): Promise<OnChainHandleView[]> {
    const url = this.config.get<string>("INDEXER_URL");
    if (!url) {
      this.logger.warn("INDEXER_URL unset — on-chain handles unavailable (empty registry).");
      return [];
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query:
            "{ Handle { id contract owner { id } name symbol metadata windowMinutes sources market oracleFactory revenue stake graduated categories } }",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
      const json = (await res.json()) as {
        data?: { Handle?: unknown[] };
        errors?: { message?: string }[];
      };
      if (json.errors?.length) {
        throw new Error(json.errors[0]?.message ?? "graphql error");
      }
      const views = normalize(json.data?.Handle ?? []);
      this.cached = views;
      try {
        await this.redis.set(CACHE_KEY, JSON.stringify(views));
      } catch {
        /* redis down — in-memory mirror only */
      }
      this.logger.log(`Synced ${views.length} on-chain handles from the indexer`);
      return views;
    } catch (error) {
      this.logger.warn(`Indexer handle sync failed: ${(error as Error).message}`);
      return this.cached;
    }
  }
}

function parseHandles(raw: string): OnChainHandleView[] {
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return [];
  }
}

function normalize(rows: unknown[]): OnChainHandleView[] {
  return rows
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      id: String(r.id ?? ""),
      contract: String(r.contract ?? ""),
      // `owner` is the indexer's User relation — extract the wallet id.
      owner: String(
        (r.owner as { id?: unknown } | null | undefined)?.id ??
          r.owner ??
          "",
      ),
      name: String(r.name ?? ""),
      symbol: String(r.symbol ?? ""),
      metadata: String(r.metadata ?? ""),
      windowMinutes: BigInt(String(r.windowMinutes ?? "0")),
      sources: Array.isArray(r.sources) ? r.sources.map(String) : [],
      market: String(r.market ?? ""),
      oracleFactory: String(r.oracleFactory ?? ""),
      revenue: String(r.revenue ?? ""),
      stake: String(r.stake ?? ""),
      graduated: Boolean(r.graduated ?? false),
      // The indexer carries the raw on-chain category CODES ([BigInt!]!).
      categories: (Array.isArray(r.categories) ? r.categories : []).map((c) => Number(c)),
    }))
    .filter((h) => h.id.length > 0);
}
