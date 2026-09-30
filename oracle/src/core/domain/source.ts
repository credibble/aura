import type { SourceKind } from "@aura/contracts";
import type { RawDatum } from "./source-item";

/**
 * A source is an independent, interval-driven collector of internet activity
 * (e.g. "bbc-sports", "x-elon", "spotify-@dev"). Two kinds of source exist:
 *
 *  - transport sources  — fetch a feed (rss / gdelt / reddit / ...) into
 *                         scored feed items for sentiment.
 *  - adapter sources    — a platform adapter (BaseSource) that extracts its
 *                         OWN metrics (Spotify: listeners/followers; Shopify:
 *                         sales/customers; BBC: articles) into a time series
 *                         used for deltas, charts and the aura index.
 *
 * Adapter sources are configured by a JSON object string (the on-chain
 * `Handle.sources[]`), e.g. `{ "platform": "spotify", "username": "@dev" }` —
 * each platform reads the fields it understands and ignores the rest.
 */

export type SourceTransport =
  | { type: "rss"; feedUrl: string }
  | { type: "gdelt"; query: string }
  | { type: "reddit"; subreddit: string }
  | { type: "youtube"; query: string }
  | { type: "hackernews"; query: string }
  | { type: "github"; query: string }
  | { type: "wikipedia"; query: string };

/** A metric an adapter extracts into its time series (e.g. "listeners"). */
export interface MetricDef {
  key: string;
  label: string;
  /** Display unit ("monthly listeners", "$/day"). */
  unit?: string;
  /** Direction of goodness — drives how the metric moves the aura index. */
  higherIsBetter?: boolean;
  /** Where the value comes from ("Spotify API /artists/{id}"). */
  source?: string;
}

/** One point in a metric's time series (epoch ms). */
export interface MetricPoint {
  timestamp: number;
  value: number;
  /** Change vs the PREVIOUS entry in the series (value − prevValue), computed
   *  by the time-series store on append. Adapters emit absolute values; the
   *  delta is derived (deltaFollowers, deltaSales, deltaStars, deltaArticles…). */
  delta?: number;
}

/** Adapter config — the JSON source string on the Handle, e.g.
 *  `{ platform: "spotify", username: "@dev" }`. Platform-specific params are
 *  extra keys; every adapter reads only what it owns. */
export interface SourceConfig {
  platform: string;
  [key: string]: string | number | boolean | undefined;
}

/** What an adapter returns each fetch cycle. */
export interface AdapterSample {
  /** Extracted series per metric key (already timestamped). */
  points: Record<string, MetricPoint[]>;
  /** Optional feed items (news articles, posts) for sentiment scoring. */
  items?: RawDatum[];
}

/**
 * Credentials an adapter needs to reach its platform — NEVER stored on-chain
 * (the Handle `sources[]` JSON is public). They live in the ConnectionStore
 * (OAuth tokens / API keys / secrets, persisted + encrypted in Postgres) and
 * are resolved by platform + account, then passed to the adapter at fetch time.
 */
export interface AdapterCredentials {
  /** OAuth2 access token (short-lived). */
  accessToken?: string;
  /** OAuth2 refresh token — exchanged for a new access token when expired. */
  refreshToken?: string;
  /** Long-lived API key (e.g. a reseller key). */
  apiKey?: string;
  /** Extra secrets, keyed by name ("clientSecret", "webhookSecret", ...). */
  secrets?: Record<string, string>;
  /** The account this credential belongs to (username / shop / artist id). */
  account?: string;
}

export interface Source {
  id: string;
  kind: SourceKind;
  /** Structural credibility (BBC article outranks a tweet). */
  weight: number;
  /** How often this source is fetched. */
  fetchIntervalMs: number;
  /** Feed transport — absent for adapter sources. */
  transport?: SourceTransport;
  /** Human label for the feed synthesizer ("BBC Sport"). */
  label: string;
  /**
   * How the AI should read this source: what the outlet actually covers and how
   * much to trust its framing. Rendered into the prompt as `context="…"`. Set for
   * the static feeds too (the news desks), not just adapter configs — otherwise
   * every outlet reached the model with no framing at all.
   */
  context?: string;
  /** Subject the source is about; items containing it are flagged <<MENTION>>. */
  topic?: string;
  /** Adapter source: the platform config (JSON) this source was built from. */
  adapter?: SourceConfig;
  /** Adapter source: the metrics it extracts into its time series. */
  metrics?: MetricDef[];
}

/** How a handle decides which sources feed it. */
export interface HandleSourceRule {
  /** Category default source ids. */
  byCategory: Partial<Record<SourceKind, readonly string[]>>;
  /** Handle-specific additions. */
  extra: readonly string[];
  /** Handle-specific exclusions. */
  exclude: readonly string[];
}

export function allowedSourcesFor(rule: HandleSourceRule): readonly string[] {
  const allowed = new Set<string>();
  for (const list of Object.values(rule.byCategory)) {
    for (const id of list ?? []) allowed.add(id);
  }
  for (const id of rule.extra) allowed.add(id);
  for (const id of rule.exclude) allowed.delete(id);
  return [...allowed];
}
