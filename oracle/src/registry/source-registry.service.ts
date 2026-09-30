import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Inject } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS } from "../queue/queue.constants";
import { SOURCE_REGISTRY } from "../core/ports/tokens";
import type { SourceRegistry } from "../core/ports/source-registry";
import type { Source } from "../core/domain/source";
import { SOURCES } from "./source-seed";
import { SubgraphHandleSync } from "./subgraph-handle-sync.service";
import { AdapterRegistry } from "../adapters/adapter-registry.service";
import { bytes32ToId } from "../core/domain/handle";

const LAST_FETCH_PREFIX = "oracle:source:last-fetched:";

/**
 * The global source universe: static feed transports (SOURCES) plus the adapter
 * sources derived from every ON-CHAIN handle's `sources[]` JSON configs. Handle
 * → source rules are NOT seeded — they follow the chain. Last-fetch time is
 * tracked in Redis so every distributed worker agrees on which sources are
 * ready for a batch.
 */
@Injectable()
export class SourceRegistryService implements SourceRegistry, OnModuleInit {
  private readonly logger = new Logger(SourceRegistryService.name);
  private handleSourceMap = new Map<string, string[]>();
  private adapterSources: Source[] = [];

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly sync: SubgraphHandleSync,
    private readonly adapters: AdapterRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rebuildFromChain();
    const intervalMs = this.config.get<number>("SUBGRAPH_CACHE_TTL_MS") ?? 60_000;
    setInterval(() => void this.rebuildFromChain(), intervalMs);
  }

  /** Rebuild the adapter source universe + handle→source map from on-chain handles. */
  private async rebuildFromChain(): Promise<void> {
    const views = await this.sync.handles();
    const sources = new Map<string, Source>();
    const byHandle = new Map<string, string[]>();

    // Adapter sources come ONLY from on-chain Handle `sources[]` JSON configs —
    // no seeded fallback when the subgraph is empty (there are no fake handles).
    const configJsons = views.flatMap((v) => v.sources);

    for (const json of configJsons) {
      const source = this.adapters.buildSourceFromJson(json);
      if (source) sources.set(source.id, source);
    }

    for (const v of views) {
      const id = bytes32ToId(v.id);
      const allowed = this.adapters.buildFromJsonStrings(v.sources).map((s) => s.id);
      for (const sourceId of allowed) {
        const list = byHandle.get(sourceId) ?? [];
        list.push(id);
        byHandle.set(sourceId, list);
      }
    }
    this.handleSourceMap = byHandle;

    this.adapterSources = [...sources.values()];
    this.logger.log(`Registry: ${this.adapterSources.length} adapter sources, ${this.handleSourceMap.size} source→handle rules`);
  }

  async all(): Promise<Source[]> {
    return [...SOURCES, ...this.adapterSources];
  }

  async get(id: string): Promise<Source | null> {
    return (await this.all()).find((s) => s.id === id) ?? null;
  }

  async ready(now: number): Promise<Source[]> {
    const ready: Source[] = [];
    for (const source of await this.all()) {
      const last = await this.lastFetchedAt(source.id);
      if (last === undefined || now - last >= source.fetchIntervalMs) {
        ready.push(source);
      }
    }
    return ready;
  }

  async markFetched(id: string, at: number): Promise<void> {
    try {
      await this.redis.set(`${LAST_FETCH_PREFIX}${id}`, String(at));
    } catch {
      this.logger.warn(`Redis markFetched failed for ${id}`);
    }
  }

  async lastFetchedAt(id: string): Promise<number | undefined> {
    try {
      const raw = await this.redis.get(`${LAST_FETCH_PREFIX}${id}`);
      return raw ? Number(raw) : undefined;
    } catch {
      return undefined;
    }
  }

  async handlesForSource(sourceId: string): Promise<string[]> {
    return this.handleSourceMap.get(sourceId) ?? [];
  }
}

export { SOURCE_REGISTRY };