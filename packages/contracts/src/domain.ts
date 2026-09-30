/**
 * Shared domain vocabulary for the Aura protocol.
 *
 * These types mirror the shape the Aura frontend already consumes (see
 * `o2-echo-canvas/src/lib/aura-data.ts`) so the oracle's output contract can be
 * contract-tested against the UI without drift.
 */

/** The nine market categories used across the app. The on-chain code for each is
 *  the plain small integer in the app's `CATEGORY_BY_CODE` (1 people, 2 crypto,
 *  3 sports, 4 ai, 5 tech, 6 brands, 7 music, 8 memes, 9 culture) — the index
 *  stores codes raw and the UI owns the mapping. */
export type CategoryId =
  | "crypto"
  | "ai"
  | "sports"
  | "people"
  | "brands"
  | "memes"
  | "music"
  | "tech"
  | "culture";

/** The four proof signals every handle's score decomposes into. */
export type SourceKind = "social" | "community" | "media" | "search";

/** A handle is either a single entity (@btc, @messi) or a grouped category (@ai, @football). */
export type HandleKind = "entity" | "category";

/** The resolution direction of a settled window. */
export type Direction = "up" | "down";

/** The single metric the protocol measures. */
export type MetricId = "aura";

/** The four sub-scores that make up a handle's index, each 0-100. */
export type ProofSignals = Record<SourceKind, number>;

export function emptyProof(fallback = 50): ProofSignals {
  return { social: fallback, community: fallback, media: fallback, search: fallback };
}

/** Static identity + behavior knobs for a marketable handle. */
export interface HandleSpec {
  /** Stable handle id — routes/feed/portfolio all key on string equality (e.g. "btc"). */
  id: string;
  symbol: string;
  name: string;
  category: CategoryId;
  kind: HandleKind;
  /** Window length in minutes (15..1440). */
  windowMinutes: number;
  color: string;
  /** Hot-linked artwork from the open web. */
  image?: string;
  imageFit?: "cover" | "contain";
  /** Initial index seed (0-100) and sensitivity hint. */
  baseline: number;
  volatility: number;
}

/**
 * The live, computed state of a handle — the oracle's primary output contract.
 * Maps 1:1 onto the frontend `LiveAsset`.
 */
export interface HandleSnapshot {
  id: string;
  symbol: string;
  name: string;
  category: CategoryId;
  kind: HandleKind;
  color: string;
  image?: string;
  imageFit?: "cover" | "contain";
  /** Bounded index P_t, 0-100. */
  index: number;
  /** Percent move of the index over the current window. */
  change: number;
  /** Implied probability (0-100) the window resolves up. */
  up: number;
  /** 100 - up. */
  down: number;
  velocity: number;
  shock: number;
  /** Share of the category's aggregated score — powers grouped markets. */
  dominance: number;
  /** Trading-owned until the on-chain engine is wired. */
  volume: number;
  participants: number;
  /** Rolling index series (length 64); window open lives at len-20. */
  history: number[];
  spark: number[];
  windowShort: string;
  windowLong: string;
  windowMinutes: number;
  metric: MetricId;
  proof: ProofSignals;
  /** AI-synthesized market context. */
  summary: string;
  drivers: string[];
  baseline: number;
  volatility: number;
  /** Server timestamp of this snapshot (epoch ms). */
  ts: number;
}

export function windowLabel(minutes: number): { short: string; long: string } {
  if (minutes < 60) return { short: `${minutes}m`, long: `${minutes}-minute` };
  if (minutes === 60) return { short: "1h", long: "1-hour" };
  if (minutes < 1440) return { short: `${minutes / 60}h`, long: `${minutes / 60}-hour` };
  if (minutes === 1440) return { short: "1d", long: "1-day" };
  return { short: `${minutes}m`, long: `${minutes}-minute` };
}