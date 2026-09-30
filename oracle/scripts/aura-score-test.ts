import "dotenv/config";
import { ConfigService } from "@nestjs/config";
import { SubgraphReader } from "../src/jobs/subgraph/subgraph-reader.service";
import { AdapterRegistry } from "../src/adapters/adapter-registry.service";
import { SourceFetcher } from "../src/ingestion/source-fetcher.service";
import { SourceCacheService } from "../src/jobs/source-cache/source-cache.service";
import { ChainGateway } from "../src/jobs/chain/chain-gateway.service";
import { AuraEngineService } from "../src/jobs/aura/aura-engine.service";
import { KimiAiModel } from "../src/adapters/ai/llm/kimi-ai.model";
import { KimiWebSearchService } from "../src/jobs/ai/kimi-web-search.service";
import type { ITimeSeriesStore } from "../src/core/ports/time-series-store";
import type { MetricPoint } from "../src/core/domain/source";

/** Minimal in-memory time-series store (drives history + delta math). */
class MemorySeries implements ITimeSeriesStore {
  private series = new Map<string, MetricPoint[]>();
  private key(sourceId: string, metric: string): string {
    return `${sourceId}::${metric}`;
  }
  async append(sourceId: string, metric: string, point: MetricPoint): Promise<void> {
    const k = this.key(sourceId, metric);
    const arr = this.series.get(k) ?? [];
    const prev = arr[arr.length - 1];
    arr.push({ ...point, delta: point.delta ?? (prev ? point.value - prev.value : 0) });
    this.series.set(k, arr);
  }
  async appendSample(sourceId: string, points: Record<string, MetricPoint[]>): Promise<void> {
    for (const [metric, pts] of Object.entries(points)) {
      for (const p of pts) await this.append(sourceId, metric, p);
    }
  }
  async points(sourceId: string, metric: string, fromMs?: number, toMs?: number): Promise<MetricPoint[]> {
    const arr = (this.series.get(this.key(sourceId, metric)) ?? []).filter(
      (p) => (fromMs === undefined || p.timestamp >= fromMs) && (toMs === undefined || p.timestamp <= toMs),
    );
    return arr;
  }
  async latest(sourceId: string, metric: string): Promise<MetricPoint | null> {
    const arr = this.series.get(this.key(sourceId, metric)) ?? [];
    return arr[arr.length - 1] ?? null;
  }
  async pctChange(sourceId: string, metric: string, fromMs: number, toMs: number): Promise<number | null> {
    const arr = await this.points(sourceId, metric, fromMs, toMs);
    if (arr.length < 2) return null;
    const a = arr[0]!.value;
    const b = arr[arr.length - 1]!.value;
    return a === 0 ? null : ((b - a) / a) * 100;
  }
  async chart(sourceId: string, metric: string, sinceMs: number, bucketMs?: number): Promise<MetricPoint[]> {
    return this.points(sourceId, metric, sinceMs);
  }
}

/** In-memory Redis stand-in so the source cache actually caches across calls. */
class MemoryRedis {
  private store = new Map<string, string>();
  get = async (k: string) => this.store.get(k) ?? null;
  set = async (k: string, v: string) => {
    this.store.set(k, v);
  };
  expire = async () => 1;
}

const cfg = new ConfigService({
  SUBGRAPH_URL: process.env.SUBGRAPH_URL,
  RPC_URL: process.env.RPC_URL,
  ALCHEMY_RPC_URL: process.env.ALCHEMY_RPC_URL,
  ORACLE_PRIVATE_KEY: process.env.ORACLE_PRIVATE_KEY,
  MARKET_MAKER_ADDRESS: process.env.MARKET_MAKER_ADDRESS,
  ORACLE_FACTORY_ADDRESS: process.env.ORACLE_FACTORY_ADDRESS,
  CHAIN_ID: 10143,
});

const log = (step: string, msg: string): void => console.log(`[${step}] ${msg}`);
const logBlock = (title: string, body: string): void => {
  console.log(`\n───── ${title} ─────`);
  console.log(body);
  console.log("──────────────────────────────");
};

async function main(): Promise<void> {
  const writeOnChain = process.env.WRITE_ON_CHAIN === "true";
  logBlock(
    "Config",
    `subgraph   = ${cfg.get("SUBGRAPH_URL")}\n` +
      `model      = ${cfg.get("KIMI_MODEL")} @ ${cfg.get("KIMI_BASE_URL")}\n` +
      `webSearch = ${Boolean(process.env.MOONSHOT_API_KEY) ? "enabled" : "disabled"}\n` +
      `write      = ${writeOnChain ? "ON-CHAIN" : "dry-run"}`,
  );

  const redis = new MemoryRedis();
  const subgraph = new SubgraphReader(cfg, redis as never);
  const series = new MemorySeries();
  const adapters = new AdapterRegistry();
  const fetcher = new SourceFetcher(cfg, adapters, series, { get: async () => null } as never);
  const cache = new SourceCacheService(redis as never);

  // One handle at a time — the AI only analyses a single handle per run.
  log("subgraph", "loading handles…");
  const handles = await subgraph.handles();
  const ronaldo =
    handles.find((h) => h.label.toLowerCase() === "ron" || h.id.toLowerCase().includes("ronaldo")) ??
    handles.find((h) => h.sources.length > 0);
  if (!ronaldo) throw new Error("@ronaldo not found in subgraph");
  log("subgraph", `found @${ronaldo.label} — aura=${ronaldo.aura}, graduated=${ronaldo.graduated}, category=${ronaldo.category}`);
  for (const s of ronaldo.sources) log("on-chain source", s);

  const chain = writeOnChain
    ? await chainGateway(cfg)
    : {
        onChainAura: async () => null,
        updateAura: async (c: string, aura: number) => {
          log("dry-run", `updateAura(${aura}) on ${c} — NOT SENT`);
          return true;
        },
      };
  const ws = {
    publishAura: (d: unknown) => log("ws", `aura.updated ${JSON.stringify(d)}`),
    publishFeed: () => undefined,
    publishWindowOpened: () => undefined,
    publishWindowResolved: () => undefined,
  };

  const ai = new KimiAiModel(cfg, globalThis.fetch.bind(globalThis), new KimiWebSearchService(cfg));
  const engine = new AuraEngineService(cfg, adapters, fetcher, cache, chain as never, ws as never, ai, series);

  const now = Date.now();
  log("engine", "fetching sources + building signals…");
  const signals = await engine.signals(ronaldo, now);
  log("engine", `${signals.length} source signal(s) collected`);
  for (const s of signals) {
    logBlock(
      `signal — ${s.label} (${s.sourceId})`,
      `reliability = ${s.weight}\n` +
        `metrics     = ${s.metrics.map((m) => `${m.name}=${m.value}(Δ${m.delta})`).join(", ") || "(none)"}\n` +
        `items (${s.items.length}) = ${JSON.stringify(s.items.slice(0, 3), null, 0)}\n` +
        `context     = ${s.context ?? "(none)"}`,
    );
  }

log("ai", `calling ${cfg.get("KIMI_MODEL")} (tools: web_search, current_time)…`);
  const groups = signals.map((s) => ({
    label: s.label,
    reliability: s.weight,
    items: s.items,
    metrics: s.metrics,
    context: s.context,
    topic: s.topic,
  }));

  // Prior tick from the Postgres aura series (the engine passes this to the AI).
  const last = await series.latest("aura:ron", "aura");
  const previous = {
    aura: last ? last.value / 100 : undefined,
    delta: last?.delta !== undefined ? last.delta / 100 : undefined,
  };

  const scored = await ai.scoreWithSummary(ronaldo.label, groups, previous);
  logBlock(
    "AURA SCORE (pass 1)",
    `handle      = @${ronaldo.label}\n` +
      `previous    = ${previous.aura !== undefined ? `aura=${previous.aura.toFixed(2)}, delta=${previous.delta?.toFixed(2)}` : "none"}\n` +
      `aura        = { ${scored.aura > 0 ? "+" : ""}${scored.aura.toFixed(2)} }\n` +
      `summary     = ${scored.summary || "(no summary)"}\n` +
      `mode        = ${writeOnChain ? "ON-CHAIN WRITE" : "dry-run"}`,
  );

  // Pass 2 — the previous summary now flows back into the AI's context.
  const scored2 = await ai.scoreWithSummary(ronaldo.label, groups, { aura: (ronaldo.aura + scored.aura * 100) / 100, delta: scored.aura, summary: scored.summary });
  logBlock(
    "AURA SCORE (pass 2 — prior summary fed back)",
    `previous    = delta=${scored2 ? scored.aura.toFixed(2) : "?"}, summary="${scored.summary?.slice(0, 90)}…"\n` +
      `aura        = { ${scored2.aura > 0 ? "+" : ""}${scored2.aura.toFixed(2)} }\n` +
      `summary     = ${scored2.summary || "(no summary)"}`,
  );
}

async function chainGateway(cfg: ConfigService): Promise<ChainGateway> {
  const g = new ChainGateway(cfg);
  await g.onModuleInit();
  return g;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});