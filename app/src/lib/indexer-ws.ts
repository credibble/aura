/**
 * Indexer subscriptions — the WebSocket half of the GraphQL client.
 *
 * The indexer streams every change as it indexes it, so a surface backed by a
 * subscription updates the moment the block lands instead of on a timer. The
 * HTTP query still loads first (SSR-safe, gives `isLoading`/error states); the
 * subscription only keeps it fresh.
 *
 * Polling is the DEGRADED mode, not a second data model: `isCoveredLive()` reports
 * whether a live subscription owns a query key, `lib/poll-registry.ts` stands its
 * timers down while that holds, and they resume automatically when the socket
 * drops. The Envio docs are explicit that hosted WebSocket support is
 * plan-dependent, so the UI must never *require* the socket.
 *
 * Subscriptions are client-only: the client is created lazily on first use, and
 * never during SSR.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient, type Client } from "graphql-ws";
import { INDEXER_WS_URL } from "./graphql";

/** Subscription payload shape (a single result, like a one-shot query). */
type Payload<T> = { data?: T; errors?: { message: string }[] };

let client: Client | null = null;
let live = false;
/** Query keys a live subscription currently covers (refcounted). */
const covered = new Map<string, number>();
const listeners = new Set<() => void>();

/** Stable key — must match `pollKey()` in lib/poll-registry.ts. */
function cacheKey(queryKey: readonly unknown[]): string {
  return JSON.stringify(queryKey);
}

function notify(): void {
  for (const listener of listeners) listener();
}

function getClient(): Client | null {
  if (typeof window === "undefined") return null;
  if (client) return client;
  client = createClient({
    url: INDEXER_WS_URL,
    // Connect on the first subscription, not at import time.
    lazy: true,
    retryAttempts: Number.POSITIVE_INFINITY,
    shouldRetry: () => true,
    on: {
      connected: () => {
        live = true;
        notify();
      },
      closed: () => {
        live = false;
        notify();
      },
      error: () => {
        live = false;
        notify();
      },
    },
  });
  return client;
}

/** Is the subscription socket connected right now? */
export function indexerSocketLive(): boolean {
  return live;
}

/**
 * Does a live subscription cover this query key? While it does, polling for that
 * key is pointless — the socket is already the event source.
 */
export function isCoveredLive(queryKey: readonly unknown[]): boolean {
  return live && covered.has(cacheKey(queryKey));
}

export type LiveMode = "invalidate" | "patch";

export type SubscribeOptions<T> = {
  queryKey: readonly unknown[];
  /** The subscription document (`subscription { … }`), same dialect as a query. */
  query: string;
  variables?: Record<string, unknown>;
  /** Hand each payload's `data` to the caller. */
  onValue: (data: T) => void;
  onError?: (error: unknown) => void;
};

/** Subscribe for the life of a surface; returns the unsubscribe. */
export function subscribeIndexer<T>({
  queryKey,
  query,
  variables,
  onValue,
  onError,
}: SubscribeOptions<T>): () => void {
  const c = getClient();
  if (!c) return () => {};

  const k = cacheKey(queryKey);
  covered.set(k, (covered.get(k) ?? 0) + 1);

  const dispose = c.subscribe<T>(
    { query, variables: variables ?? {} },
    {
      next: (message) => {
        if (message.errors?.length || !message.data) return;
        onValue(message.data);
      },
      error: (error) => onError?.(error),
      complete: () => {},
    },
  );

  return () => {
    dispose();
    const count = (covered.get(k) ?? 1) - 1;
    if (count <= 0) covered.delete(k);
    else covered.set(k, count);
  };
}

/**
 * Keep one TanStack Query cache entry fresh from an indexer subscription.
 *
 * `invalidate` (default) re-runs the surface's own query — right for lists and
 * paged collections, where a delta would have to be merged into pages.
 * `patch` writes the payload through `apply(payload, previous)` — right for a
 * single row (a window, its book, pool stats) where there is nothing to merge.
 *
 * Returns whether the socket is live, so a surface can show a "live" state.
 */
export function useIndexerLive<T>({
  queryKey,
  query,
  variables,
  enabled = true,
  mode = "invalidate",
  apply,
}: {
  queryKey: readonly unknown[];
  query: string;
  variables?: Record<string, unknown>;
  enabled?: boolean;
  mode?: LiveMode;
  apply?: (payload: T, previous: unknown) => unknown;
}): boolean {
  const queryClient = useQueryClient();
  const [isLive, setIsLive] = useState(live);

  const applyRef = useRef(apply);
  applyRef.current = apply;
  const signature = JSON.stringify([queryKey, query, variables]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeIndexer<T>({
      queryKey,
      query,
      variables,
      onValue: (data) => {
        if (mode === "patch" && applyRef.current) {
          queryClient.setQueryData(queryKey, (previous: unknown) =>
            applyRef.current?.(data, previous),
          );
        } else {
          void queryClient.invalidateQueries({ queryKey });
        }
      },
    });
    // `signature` covers queryKey/query/variables by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, signature, enabled, mode]);

  useEffect(() => {
    const listener = () => setIsLive(live);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return isLive;
}
