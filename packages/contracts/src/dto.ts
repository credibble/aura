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
