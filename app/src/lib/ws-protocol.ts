/**
 * WebSocket wire protocol — mirrors `packages/contracts/src/protocol.ts`.
 *
 * The app sits outside the npm workspace so it cannot import
 * `@aura/contracts`; keep this file in sync with the server-side protocol.
 * Server messages are push-only (snapshot/aura/feed/window/social/
 * notification); the client only ever sends `auth`.
 */

export const WS_VERSION = 1 as const;

/** Live aura update (1e2-scaled on-chain; display = /100). */
export interface AuraUpdate {
  handleId: string;
  aura: number;
  delta: number;
  ts: number;
}

export interface NotificationPush {
  id: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  ts: number;
}

export type SocialOp =
  | "post.created"
  | "post.deleted"
  | "comment.created"
  | "comment.deleted"
  | "engagement";

export interface SocialPush {
  op: SocialOp;
  postId?: string;
  handleId?: string;
  stats?: { likes?: number; reposts?: number; replies?: number };
}

export type WsServerMessage =
  | { v: typeof WS_VERSION; type: "hello"; ts: number; data: { handles: unknown[] } }
  | { v: typeof WS_VERSION; type: "snapshot"; ts: number; data: { handleId: string } }
  | { v: typeof WS_VERSION; type: "aura"; ts: number; data: AuraUpdate }
  | { v: typeof WS_VERSION; type: "feed"; ts: number; data: { handleId?: string } }
  | { v: typeof WS_VERSION; type: "window"; ts: number; data: { handleId?: string } }
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
  | { v: typeof WS_VERSION; type: "social"; ts: number; data: SocialPush }
  | { v: typeof WS_VERSION; type: "notification"; ts: number; data: NotificationPush }
  | { v: typeof WS_VERSION; type: "pong"; ts: number };

export type WsClientMessage =
  | { v: typeof WS_VERSION; type: "auth"; data: { userId: string } }
  | { v: typeof WS_VERSION; type: "hello"; data: { since?: number } }
  | { v: typeof WS_VERSION; type: "ping" };

export function isWsServerMessage(value: unknown): value is WsServerMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as { v?: unknown; type?: unknown };
  return m.v === WS_VERSION && typeof m.type === "string";
}
