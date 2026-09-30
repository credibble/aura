import type { FeedEvent, Fill, MarketStats } from "./dto";
import type { HandleSnapshot } from "./domain";
import type { WindowResult } from "./receipt";

/**
 * The event bus contract. Every event is a versioned envelope on a Redis
 * channel or stream. Owners persist their own copy; consumers never read
 * another service's database.
 */

export const EVENT_VERSION = 1 as const;

export type EventSource = "oracle" | "trading" | "chain";

export type EventType =
  | "window.opened"
  | "window.frozen"
  | "window.resolved"
  | "window.voided"
  | "handle.snapshot"
  | "aura.updated"
  | "feed.event"
  | "market.opened"
  | "market.locked"
  | "market.settled"
  | "market.voided"
  | "market.stats"
  | "fill.filled"
  | "notification.pushed"
  | "social";

export interface AuraEvent<T extends EventType = EventType, D = unknown> {
  v: typeof EVENT_VERSION;
  source: EventSource;
  type: T;
  /** Epoch ms. */
  ts: number;
  /** Monotonic per-source sequence for ordering/dedup. */
  seq: number;
  data: D;
}

export interface WindowOpenedData {
  handleId: string;
  windowStart: number;
  windowEnd: number;
  windowMinutes: number;
  /** Priced-in baseline E_t at open. */
  expectation: number;
  indexOpen: number;
}

export interface WindowFrozenData {
  handleId: string;
  windowStart: number;
  /** Frozen at T-60s. */
  frozenAt: number;
}

export interface WindowVoidedData {
  handleId: string;
  windowStart: number;
  reason: string;
  voidedAt: number;
}

export interface WindowOpenedEvent extends AuraEvent<"window.opened", WindowOpenedData> {}
export interface WindowFrozenEvent extends AuraEvent<"window.frozen", WindowFrozenData> {}
export interface WindowResolvedEvent extends AuraEvent<"window.resolved", WindowResult> {}
export interface WindowVoidedEvent extends AuraEvent<"window.voided", WindowVoidedData> {}
export interface HandleSnapshotEvent extends AuraEvent<"handle.snapshot", HandleSnapshot> {}
export interface FeedEventMessage extends AuraEvent<"feed.event", FeedEvent> {}

/** Live aura update pushed by the aura job scheduler (every 10s per handle). */
export interface AuraUpdateData {
  handleId: string;
  /** New aura level (1e2-scaled on-chain; display = /100). */
  aura: number;
  /** Change vs the previous tick (+/-). */
  delta: number;
  ts: number;
}
export interface AuraUpdatedEvent extends AuraEvent<"aura.updated", AuraUpdateData> {}

export interface MarketOpenedEvent extends AuraEvent<"market.opened", { marketId: string; handleId: string; windowStart: number }> {}
export interface MarketLockedEvent extends AuraEvent<"market.locked", { marketId: string; handleId: string; windowStart: number }> {}
export interface MarketSettledEvent extends AuraEvent<"market.settled", { marketId: string; handleId: string; windowStart: number; direction: "up" | "down"; resolutionHash: string }> {}
export interface MarketVoidedEvent extends AuraEvent<"market.voided", { marketId: string; handleId: string; windowStart: number; reason: string }> {}
export interface MarketStatsEvent extends AuraEvent<"market.stats", MarketStats> {}
export interface FillFilledEvent extends AuraEvent<"fill.filled", Fill> {}

/** A user-targeted push notification (routed to that user's sockets only). */
export interface NotificationPushedData {
  userId: string;
  notification: { id: string; kind: string; title: string; body: string; read: boolean; ts: number };
}
export interface NotificationPushedEvent extends AuraEvent<"notification.pushed", NotificationPushedData> {}

export type SocialOp =
  | "post.created"
  | "post.deleted"
  | "comment.created"
  | "comment.deleted"
  | "engagement";

/** Social-layer mutation fan-out (posts, comments, likes, reposts). */
export interface SocialEventData {
  op: SocialOp;
  /** Post id (`user:…`/`feed:…`) for engagement/comment events. */
  postId?: string;
  /** Handle that owns the post (`post.created`). */
  handleId?: string;
  /** Fresh denormalized counters (`engagement`). */
  stats?: { likes?: number; reposts?: number; replies?: number };
}
export interface SocialEvent extends AuraEvent<"social", SocialEventData> {}

export type AuraEventUnion =
  | WindowOpenedEvent
  | WindowFrozenEvent
  | WindowResolvedEvent
  | WindowVoidedEvent
  | HandleSnapshotEvent
  | AuraUpdatedEvent
  | FeedEventMessage
  | MarketOpenedEvent
  | MarketLockedEvent
  | MarketSettledEvent
  | MarketVoidedEvent
  | MarketStatsEvent
  | FillFilledEvent
  | NotificationPushedEvent
  | SocialEvent;

export function isAuraEvent(value: unknown): value is AuraEventUnion {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Partial<AuraEventUnion>;
  return e.v === EVENT_VERSION && typeof e.source === "string" && typeof e.type === "string";
}

/** Redis channels used by the oracle and trading services. */
export const CHANNELS = {
  /** Durable stream: oracle window lifecycle events (must-not-miss). */
  oracleWindowStream: "oracle:window:events",
  /** Pub/sub fan-out for snapshots + feed (informational). */
  oraclePubSub: "oracle:events",
  /** Pub/sub for trading market lifecycle events. */
  tradingEvents: "trading:events",
  /** Live stats key per handle, written by trading, read by the gateway. */
  statsKey: (handleId: string): string => `stats:${handleId}`,
} as const;