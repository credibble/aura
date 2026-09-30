import type { SourceKind } from "@aura/contracts";
import type { AdapterCredentials, AdapterSample, MetricDef, Source, SourceConfig } from "../core/domain/source";

/**
 * BaseSource — the contract every platform adapter implements. Each adapter
 * knows how to extract ITS OWN data in ITS OWN way (Spotify: listeners +
 * followers; Shopify: sales + customers; BBC: articles) and feeds it into a
 * metric time series that drives deltas, charts and the aura index.
 *
 * Adapters are pure — no NestJS deps — so they are trivially unit-testable
 * and shared between the collector and the API. An adapter is selected by the
 * `platform` field of the on-chain Handle's source JSON config.
 */
export abstract class BaseSource {
  /** Platform key — matches `config.platform` ("spotify", "x", ...). */
  abstract readonly platform: string;
  /** Platform-specific data variant when a platform has several adapters
   *  (e.g. X → "timeline" | "profile" | "search"). One adapter per variant. */
  readonly variant?: string;
  /** Every metric this adapter extracts, with its display metadata. */
  abstract readonly metrics: MetricDef[];
  /** Default fetch cadence. */
  abstract readonly fetchIntervalMs: number;
  /** Structural credibility weight. */
  abstract readonly weight: number;
  /** Sentiment kind — how the extracted data feeds the aura index. */
  abstract readonly kind: SourceKind;
  /** Credential keys this adapter needs to reach its platform (OAuth/API key).
   *  Empty for public endpoints (BBC RSS). Never from the on-chain config. */
  readonly requiredCredentials: readonly string[] = [];

  /** Extract this platform's own data as a metric sample (its own way).
   *  `credentials` carries the platform's secrets resolved by the ConnectionStore
   *  (never stored on-chain); adapters fall back to a synthesized series when
   *  none are configured. */
  abstract fetch(
    config: SourceConfig,
    since: number,
    now: number,
    credentials?: AdapterCredentials,
  ): Promise<AdapterSample>;

  /** Stable source id derived from the config, e.g. "spotify-@dev". */
  abstract id(config: SourceConfig): string;

  /** Human label, e.g. "Spotify — @dev". */
  abstract label(config: SourceConfig): string;

  /** Registry key: `platform` + optional `variant`. */
  registryKey(): string {
    return this.variant ? `${this.platform}::${this.variant}` : this.platform;
  }

  /** Build the runtime Source descriptor for the collector/registry. */
  toSource(config: SourceConfig): Source {
    return {
      id: this.id(config),
      kind: this.kind,
      weight: this.weight,
      fetchIntervalMs: this.fetchIntervalMs,
      label: this.label(config),
      // Per-handle guidance carried by the on-chain source JSON. Without copying
      // them here they never reach the AI: the prompt renders `context="…"` and
      // flags `<<MENTION>>` by topic, both of which read off the Source.
      context: this.str(config, "context") ?? undefined,
      topic: this.str(config, "topic") ?? undefined,
      adapter: config,
      metrics: this.metrics,
    };
  }

  /** Read a config field safely (adapters ignore fields they don't own). */
  protected str(config: SourceConfig, key: string): string | undefined {
    const v = config[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  }

  protected num(config: SourceConfig, key: string): number | undefined {
    const v = config[key];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  }
}