/**
 * Live WebSocket client — the app's push channel to the oracle gateway.
 *
 * WS-first policy: every query covered by a push event drops its `meta.pollMs`
 * and relies on this socket instead. Each server message invalidates (or
 * patches) exactly the TanStack Query caches it affects, debounced so a burst
 * of per-handle ticks collapses into one refetch. `hello` arrives on every
 * connect; on RE-connect it resyncs the whole covered set — that resync is
 * what makes safety-net polling unnecessary for covered queries.
 *
 * Remaining polls (positions, open orders, user handles, pool stats) have no
 * event source yet — see `poll-registry.ts` for the policy.
 *
 * Protocol mirrors packages/contracts/src/protocol.ts (see ws-protocol.ts).
 */
import { io, type Socket } from "socket.io-client";
import type { QueryClient } from "@tanstack/react-query";
import { getJwt } from "./api";
import { API_BASE } from "./privy";
import { qk } from "@/queries/keys";
import { WS_VERSION, isWsServerMessage, type WsServerMessage } from "./ws-protocol";

/** Query prefixes kept live by push events — invalidated wholesale on resync. */
const COVERED: readonly (readonly unknown[])[] = [
  qk.handles,
  ["handle"],
  ["aura-history"],
  ["feed"],
  ["posts"],
  ["search"],
  ["post"],
  ["comments"],
  ["windows"],
  ["window"],
  ["handle-windows"],
  ["stats"],
  ["leaderboard"],
  ["notifications"],
  ["bookmarks"],
  ["reposted"],
  ["people-search"],
  // Oracle-owned surfaces (connections/metadata) + the on-chain vaults the app
  // reads through the subgraph: a reconnect resync refreshes every one of them.
  ["handle-connection"],
  ["handle-revenue"],
  ["user-handles"],
  ["pool"],
  ["pool-snapshots"],
  ["pool-events"],
  ["stake"],
  ["stake-snapshots"],
  ["positions"],
  ["open-orders"],
];

const DEBOUNCE_MS = 1_500;

let socket: Socket | null = null;
let client: QueryClient | null = null;
let user: string | null = null;
let seenHello = false;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Coalesce repeated invalidations of the same prefix into one refetch. */
function invalidateLater(prefix: readonly unknown[]): void {
  if (!client) return;
  const sig = JSON.stringify(prefix);
  const existing = timers.get(sig);
  if (existing) clearTimeout(existing);
  timers.set(
    sig,
    setTimeout(() => {
      timers.delete(sig);
      void client?.invalidateQueries({ queryKey: prefix });
    }, DEBOUNCE_MS),
  );
}

function invalidateNow(prefix: readonly unknown[]): void {
  if (!client) return;
  const sig = JSON.stringify(prefix);
  const existing = timers.get(sig);
  if (existing) {
    clearTimeout(existing);
    timers.delete(sig);
  }
  void client.invalidateQueries({ queryKey: prefix });
}

/** Patch `aura`/`auraDelta` in every cached handle list + detail in place. */
function patchAura(handleId: string, aura: number, delta: number): void {
  if (!client) return;
  const id = handleId.toLowerCase();
  const nextAura = String(aura);
  const nextDelta = String(delta);

  for (const prefix of [qk.handles, ["user-handles"], ["people-search"]] as const) {
    for (const [key, data] of client.getQueriesData<unknown[]>({ queryKey: prefix })) {
      if (!Array.isArray(data)) continue;
      let changed = false;
      const patched = data.map((item) => {
        if (
          item &&
          typeof item === "object" &&
          "id" in item &&
          String((item as { id: unknown }).id).toLowerCase() === id
        ) {
          changed = true;
          return { ...(item as object), aura: nextAura, auraDelta: nextDelta };
        }
        return item;
      });
      if (changed) client.setQueryData(key, patched);
    }
  }

  const detail = client.getQueryData(["handle", id]);
  if (detail && typeof detail === "object") {
    client.setQueryData(["handle", id], {
      ...(detail as object),
      aura: nextAura,
      auraDelta: nextDelta,
    });
  }
  // Charts re-read from the subgraph on the next tick; aura moves ~10s/handle.
  invalidateLater(qk.auraHistory(id));
}

/** Patch `stats` on one post across every cached feed/posts/search page
 *  (infinite) and its detail query — no refetch needed for counter moves. */
function patchEngagement(
  postId: string,
  stats: { likes?: number; reposts?: number; replies?: number },
): void {
  if (!client) return;
  for (const prefix of [["feed"], ["posts"], ["search"]] as const) {
    for (const [key, data] of client.getQueriesData<unknown>({ queryKey: prefix })) {
      if (!data || typeof data !== "object") continue;
      const pages = (data as { pages?: unknown }).pages;
      if (!Array.isArray(pages)) continue;
      let changed = false;
      const nextPages = pages.map((page) => {
        if (!page || typeof page !== "object") return page;
        const items = (page as { items?: unknown }).items;
        if (!Array.isArray(items)) return page;
        const idx = items.findIndex(
          (it) => it && typeof it === "object" && (it as { id?: unknown }).id === postId,
        );
        if (idx === -1) return page;
        changed = true;
        const item = items[idx] as { stats?: Record<string, unknown> };
        const nextItems = items.slice();
        nextItems[idx] = { ...(item as object), stats: { ...item.stats, ...stats } };
        return { ...(page as object), items: nextItems };
      });
      if (changed) client.setQueryData(key, { ...(data as object), pages: nextPages });
    }
  }
  const detail = client.getQueryData(["post", postId]);
  if (detail && typeof detail === "object") {
    const s = (detail as { stats?: Record<string, unknown> }).stats;
    client.setQueryData(["post", postId], { ...(detail as object), stats: { ...s, ...stats } });
  }
}

function handleMessage(raw: unknown): void {
  if (!isWsServerMessage(raw)) return;
  const msg: WsServerMessage = raw;
  switch (msg.type) {
    case "hello":
      // First hello = warm start (caches are fresh); later hellos are
      // re-connects → resync everything push-covered.
      if (seenHello) for (const prefix of COVERED) invalidateNow(prefix);
      seenHello = true;
      break;
    case "aura":
      patchAura(msg.data.handleId, msg.data.aura, msg.data.delta);
      break;
    case "feed":
      invalidateLater(["feed"]);
      invalidateLater(["posts"]);
      invalidateLater(["search"]);
      break;
    case "social": {
      const e = msg.data;
      if (e.op === "engagement") {
        if (e.postId && e.stats) patchEngagement(e.postId, e.stats);
        break;
      }
      if (e.op === "comment.created" || e.op === "comment.deleted") {
        if (e.postId) {
          invalidateLater(["comments", e.postId]);
          invalidateLater(["post", e.postId]);
        }
        break;
      }
      // post.created | post.deleted
      invalidateLater(["posts"]);
      invalidateLater(["feed"]);
      invalidateLater(["search"]);
      invalidateLater(["bookmarks"]);
      invalidateLater(["reposted"]);
      if (e.postId) invalidateNow(["post", e.postId]);
      break;
    }
    case "window":
    case "window.opened":
    case "window.frozen":
    case "window.voided":
      invalidateLater(["windows"]);
      invalidateLater(["handle-windows"]);
      invalidateLater(["window"]);
      invalidateLater(["stats"]);
      invalidateLater(["leaderboard"]);
      // A window reserving or paying out moves the auraLP vault's depth.
      invalidateLater(["pool"]);
      invalidateLater(["pool-snapshots"]);
      invalidateLater(["pool-events"]);
      break;
    case "notification":
      // Already routed to this user's sockets only.
      invalidateNow(["notifications"]);
      break;
    case "snapshot":
    case "pong":
      break; // recognized, nothing derived client-side (signals render from aura)
  }
}

function sendAuth(): void {
  if (!socket?.connected) return;
  // Prefer the wallet JWT — the server verifies it and binds the socket to the
  // proven address. Falling back to the bare address only works in dev.
  const token = getJwt();
  if (token) {
    socket.emit("message", { v: WS_VERSION, type: "auth", data: { token } });
    return;
  }
  if (!user) return;
  socket.emit("message", { v: WS_VERSION, type: "auth", data: { userId: user } });
}

/** Idempotent — creates the singleton socket bound to a QueryClient. */
export function initWs(queryClient: QueryClient): void {
  if (typeof window === "undefined" || socket) return;
  client = queryClient;

  const origin = new URL(API_BASE).origin; // strip any /v1 path prefix
  socket = io(origin, {
    path: "/socket.io",
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    timeout: 10_000,
  });

  socket.on("connect", () => {
    sendAuth();
    // hello arrives right after connect and drives the resync decision
  });
  socket.on("message", handleMessage);
  socket.on("connect_error", (err) => {
    // Reconnection is automatic; keep the console quiet in normal operation.
    if (!socket?.connected) console.debug("[ws] connect error:", err.message);
  });
}

/** Bind (or unbind) the socket to the signed-in wallet for user pushes. */
export function wsSetUser(address: string | null): void {
  const next = address ? address.toLowerCase() : null;
  if (next === user) return;
  user = next;
  sendAuth();
}

/**
 * Re-authenticate after a fresh JWT is minted (login) — the socket may already
 * be connected from before the token existed.
 */
export function wsReauth(): void {
  sendAuth();
}
