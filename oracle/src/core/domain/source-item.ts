import type { SourceKind } from "@aura/contracts";

/** Media attached to a source item — maps onto the frontend `FeedMedia`. */
export type SourceMedia = {
  kind: "image" | "video";
  url: string;
  title?: string;
};

/** Re-exported for adapters that carry platform metrics with their items. */
export type SourceCounts = Record<string, number>;

/** The raw shape every transport returns before normalization. */
export interface RawDatum {
  id?: string;
  sourceName: string;
  text: string;
  url?: string;
  author?: string;
  publishedAt: number;
  /** Aggregate engagement (kept for scoring: likes + reposts, impressions, …). */
  engagement?: number;
  /**
   * The engagement breakdown the endpoint actually returned, so the feed card can
   * show "12.4K likes · 3.1K reposts" and the AI can see reach vs reception.
   * Keys are free-form per platform (likes/replies/reposts/views/followers/score).
   */
  stats?: SourceCounts;
  media?: SourceMedia[];
}

/** A normalized, deduplicated datum collected from one source. */
export interface SourceItem {
  /** Deterministic id: hash(sourceId + dedupeKey). */
  id: string;
  /** Owning source id — "bbc-sports", "x-elon". */
  sourceId: string;
  kind: SourceKind;
  sourceName: string;
  text: string;
  url?: string;
  author?: string;
  publishedAt: number;
  collectedAt: number;
  engagement?: number;
  dedupeKey: string;
  media?: SourceMedia[];
}