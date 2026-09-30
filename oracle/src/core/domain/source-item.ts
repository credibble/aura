import type { SourceKind } from "@aura/contracts";

/** Media attached to a source item — maps onto the frontend `FeedMedia`. */
export type SourceMedia = {
  kind: "image" | "video";
  url: string;
  title?: string;
};

/** The raw shape every transport returns before normalization. */
export interface RawDatum {
  id?: string;
  sourceName: string;
  text: string;
  url?: string;
  author?: string;
  publishedAt: number;
  engagement?: number;
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