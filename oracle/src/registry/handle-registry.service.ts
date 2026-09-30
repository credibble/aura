import { Injectable } from "@nestjs/common";
import type { IHandleRegistry } from "../core/ports/handle-registry";
import type { HandleConfig, OnChainHandleView } from "../core/domain/handle";
import { bytes32ToId } from "../core/domain/handle";
import { IndexerHandleSync } from "./indexer-handle-sync.service";
import { AdapterRegistry } from "../adapters/adapter-registry.service";
import { handleDefaultMeta } from "./seed";

/**
 * The handle (handle) universe — sourced ON-CHAIN. Handles are created via the
 * HandleFactory and read through the indexer (GraphQL), cached in Redis by
 * IndexerHandleSync. There is NO seeding in the backend. The on-chain Handle
 * carries identity + sources[]; display defaults (category/color/volatility)
 * are merged from a local metadata table.
 */
@Injectable()
export class HandleRegistryService implements IHandleRegistry {
  constructor(
    private readonly sync: IndexerHandleSync,
    private readonly adapters: AdapterRegistry,
  ) {}

  async all(): Promise<HandleConfig[]> {
    const views = await this.sync.handles();
    return views.map((v) => this.toConfig(v));
  }

  async get(id: string): Promise<HandleConfig | null> {
    const views = await this.sync.handles();
    const view = views.find((v) => v.id === id || bytes32ToId(v.id) === id);
    return view ? this.toConfig(view) : null;
  }

  private toConfig(v: OnChainHandleView): HandleConfig {
    const id = bytes32ToId(v.id);
    const meta = handleDefaultMeta(id);
    // Sources come from the handle's on-chain `sources[]` JSON configs — the
    // platform adapters turn each into a source id.
    const allowedSources = this.adapters.buildFromJsonStrings(v.sources).map((s) => s.id);
    return {
      id,
      symbol: v.symbol || meta.symbol || id.toUpperCase().slice(0, 4),
      name: v.name || meta.name || id,
      category: (meta.category as HandleConfig["category"]) ?? "culture",
      kind: meta.kind ?? "entity",
      windowMinutes: Number(v.windowMinutes) || meta.windowMinutes || 15,
      color: meta.color ?? "#8b5cf6",
      image: meta.image,
      imageFit: meta.imageFit,
      baseline: meta.baseline ?? 50,
      volatility: meta.volatility ?? 0.02,
      allowedSources,
    };
  }
}