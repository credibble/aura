import type { FeedEvent, MarketStats } from "./dto";
import type { HandleSnapshot, ProofSignals } from "./domain";
import type { WindowResult } from "./receipt";
import type { SocialEventData } from "./events";

/**
 * WebSocket wire protocol between the browser and the oracle gateway.
 * Server -> client is push (snapshot deltas, feed, resolutions); client ->
 * server is subscription management + resync.
 */

export const WS_VERSION = 1 as const;

export interface HandleSnapshotDelta {
  handleId: string;
  index: number;
  change: number;
  up: number;
  down: number;
  velocity: number;
  shock: number;
  dominance: number;
  proof: ProofSignals;
  spark: number[];
  ts: number;
}

/** Live aura update (1e2-scaled on-chain; display = /100). */
export interface AuraUpdate {
  handleId: string;
  aura: number;
  delta: number;
  ts: number;
}

// --- server -> client -------------------------------------------------------

export type WsServerMessage =
  | { v: typeof WS_VERSION; type: "hello"; ts: number; data: { handles: HandleSnapshot[] } }
  | { v: typeof WS_VERSION; type: "snapshot"; ts: number; data: HandleSnapshotDelta }
  | { v: typeof WS_VERSION; type: "aura"; ts: number; data: AuraUpdate }
  | { v: typeof WS_VERSION; type: "feed"; ts: number; data: FeedEvent }
  | { v: typeof WS_VERSION; type: "window"; ts: number; data: WindowResult }
  | {
      v: typeof WS_VERSION;
      type: "window.opened";
      ts: number;
      data: { handleId: string; windowStart: number; windowEnd: number; windowMinutes: number };
    }
  | {
      v: typeof WS_VERSION;
      type: "window.frozen";
      ts: number;
      data: { handleId: string; windowStart: number; frozenAt: number };
    }
  | {
      v: typeof WS_VERSION;
      type: "window.voided";
      ts: number;
      data: { handleId: string; windowStart: number; reason: string; voidedAt: number };
    }
  | { v: typeof WS_VERSION; type: "stats"; ts: number; data: MarketStats }
  | { v: typeof WS_VERSION; type: "social"; ts: number; data: SocialEventData }
  | { v: typeof WS_VERSION; type: "notification"; ts: number; data: { id: string; kind: string; title: string; body: string; read: boolean; ts: number } }
  | { v: typeof WS_VERSION; type: "pong"; ts: number };

// --- client -> server -------------------------------------------------------

export type WsClientMessage =
  | { v: typeof WS_VERSION; type: "hello"; data: { since?: number; handles?: string[] } }
  | { v: typeof WS_VERSION; type: "subscribe"; data: string[] }
  | { v: typeof WS_VERSION; type: "unsubscribe"; data: string[] }
  | { v: typeof WS_VERSION; type: "auth"; data: { userId: string } }
  | { v: typeof WS_VERSION; type: "ping" };

const CLIENT_TYPES = ["hello", "subscribe", "unsubscribe", "auth", "ping"] as const;

export function isWsClientMessage(value: unknown): value is WsClientMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Partial<WsClientMessage> & { data?: unknown };
  if (m.v !== WS_VERSION || typeof m.type !== "string") return false;
  if (!CLIENT_TYPES.includes(m.type as (typeof CLIENT_TYPES)[number])) return false;
  if (m.type !== "ping" && (m.data === undefined || m.data === null)) return false;
  return true;
}