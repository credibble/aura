import type { SourceKind } from "./domain";
import type { WindowSlot } from "./window";

/** Feed event kinds — matches the frontend `FeedKind`. */
export type FeedEventKind = "shock" | "velocity" | "trend" | "settle" | "new";

export interface FeedEvent {
  id: string;
  assetId: string;
  kind: FeedEventKind;
  title: string;
  body: string;
  ts: number;
  change: number;
}

/** One outlet feeding an aggregate summary — frontend `ActivitySource`. */
export interface ActivitySource {
  id: string;
  name: string;
  kind: SourceKind;
  weight: number;
  change: number;
}

/** One synthesized AI feed item — frontend `ActivityNewsItem`. */
export interface ActivityNewsItem {
  id: string;
  sources: { name: string; kind: SourceKind }[];
  driver: string;
  summary: string;
  ago: string;
  change: number;
}

/** A depth level in the (AMM-derived) order book. */
export interface OrderBookLevel {
  price: number;
  shares: number;
  total: number;
}

/** Trading-owned stats the oracle snapshot composes via the gateway. */
export interface MarketStats {
  handleId: string;
  windowStart: number;
  volume: number;
  participants: number;
  openInterest: number;
  ts: number;
}

/** A user trade fill emitted by the on-chain engine. */
export interface Fill {
  id: string;
  marketId: string;
  handleId: string;
  windowStart: number;
  trader: string;
  side: "up" | "down";
  shares: number;
  price: number;
  cost: number;
  ts: number;
}

export interface HandleWindows {
  handleId: string;
  live: WindowSlot;
  past: WindowSlot[];
}