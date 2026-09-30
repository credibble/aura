/**
 * Observer-gated polling (JS IntersectionObserver + intervals).
 *
 * Polling policy (WS-first): queries covered by gateway push events or by an
 * indexer subscription do NOT need timers. `lib/ws.ts` invalidates the gateway's
 * covered set on each message; `lib/indexer-ws.ts` reports which keys a live
 * subscription owns (`isCoveredLive`), and `isPollable` stands those timers down.
 *
 * What still polls, and why it can't be push-covered yet (no event source):
 *   - market stats (volume) & window detail/prices/points/trades/orderbook —
 *     covered by indexer subscriptions for the surfaces that declare them;
 *     the rest fall back to timers;
 *   - user handles (indexer) — HandleCreated/aura updates land in the indexer;
 *     the registry surfaces subscribe where they can;
 *   - pool stats (on-chain) — contract reads; no chain-event subscription.
 * Nothing social/timeline/notification polls — those are all WS-covered.
 *
 * Queries declare `meta.pollMs`; the QueryClient's global `refetchInterval`
 * asks `isPollable()` on every tick instead of blind timers:
 *
 *   - document hidden (tab in background) → never poll (react-query also
 *     pauses, but we make it explicit here);
 *   - no gated holder mounted for the key → poll (plain refetchInterval
 *     behavior — root/warm caches keep refreshing);
 *   - ≥1 gated holder mounted → poll only while ≥1 holder intersects the
 *     viewport, so off-screen charts/timelines stop burning requests.
 *
 * `usePollGate(...keys)` is the React side: it registers the keys, observes
 * its element, and hands back a ref to attach to the surface that owns them.
 */
import { useEffect, useRef } from "react";
import { isCoveredLive } from "./indexer-ws";

type Entry = { mounted: number; visible: number };

const entries = new Map<string, Entry>();

/** Stable registry key — must match `JSON.stringify(query.queryKey)`. */
export function pollKey(queryKey: readonly unknown[]): string {
  return JSON.stringify(queryKey);
}

export type PollHandle = {
  setVisible: (visible: boolean) => void;
  release: () => void;
};

/** Register a mounted holder of `key`; call `release()` on unmount. */
export function registerPoll(key: string): PollHandle {
  const entry = entries.get(key) ?? { mounted: 0, visible: 0 };
  entry.mounted += 1;
  entries.set(key, entry);
  let on = false;
  let released = false;
  return {
    setVisible(visible) {
      if (released || visible === on) return;
      on = visible;
      const cur = entries.get(key);
      if (!cur) return;
      cur.visible += visible ? 1 : -1;
    },
    release() {
      if (released) return;
      released = true;
      const cur = entries.get(key);
      if (!cur) return;
      cur.mounted -= 1;
      if (on) cur.visible -= 1;
      if (cur.mounted <= 0) entries.delete(key);
      else entries.set(key, cur);
    },
  };
}

/** Interval for a query's `refetchInterval`, or false to skip this tick. */
export function isPollable(queryKey: readonly unknown[], pollMs?: number): number | false {
  if (!pollMs || pollMs <= 0) return false;
  // A live indexer subscription owns this key — the socket IS the event source,
  // so the timer stands down (and resumes by itself if the socket drops).
  if (isCoveredLive(queryKey)) return false;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  const entry = entries.get(pollKey(queryKey));
  if (!entry || entry.mounted === 0) return pollMs;
  return entry.visible > 0 ? pollMs : false;
}

/**
 * Gate every listed query key on one element: returns a typed ref to attach
 * to the surface (route container, card, list) that owns those keys.
 */
export function usePollGate<E extends HTMLElement = HTMLElement>(
  ...queryKeys: readonly (readonly unknown[])[]
): { current: E | null } {
  const ref = useRef<E | null>(null);
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;
  const signature = queryKeys.map(pollKey).join("|");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const handles = keysRef.current.map((k) => registerPoll(pollKey(k)));
    const io = new IntersectionObserver(
      (observed) => {
        const on = observed.some((o) => o.isIntersecting);
        for (const h of handles) h.setVisible(on);
      },
      { rootMargin: "100px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      for (const h of handles) h.release();
    };
  }, [signature]);

  return ref;
}
