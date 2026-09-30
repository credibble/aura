/**
 * Market queries — windows, orderbook, trades and price history read DIRECTLY
 * from the Envio indexer (the frontend transforms the data itself; no backend
 * proxy). The ladder is built client-side from resting ACTIVE orders + recent
 * fills; the chart is built from per-trade PricePoint snapshots (full LMSR
 * vectors).
 */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { gql } from "@/lib/graphql";
import { useIndexerLive } from "@/lib/indexer-ws";
import { qk } from "./keys";

export type IndexerWindow = {
  id: string;
  handle: {
    id: string;
    symbol: string | null;
    name: string | null;
    aura: string;
    /** On-chain category codes (1..9 → family codes). */
    categories: string[];
    /** Family ids derived from the codes — `["sports"]`. */
    windowMinutes: string;
    /** Adapter source JSON configs (the real outlets behind the index). */
    sources: string[];
    /** Raw on-chain metadata JSON — carries the handle's `photo`. */
    metadata?: string | null;
  };
  oracle: string;
  /** Parsed window metadata (the indexer decodes Oracle.metadata). */
  question: string;
  style: string;
  windowStart: string;
  windowEnd: string;
  outcomes: string[];
  /** Seeded 1e18 LMSR prices at open. */
  initialProbabilities: string[];
  /** Live LMSR prices (1e18) — maintained per trade, sum ≈ 1e18. */
  prices: string[];
  /** Outstanding shares per outcome (1e18). */
  q: string[];
  liquidity: string;
  strike: string;
  settled: boolean;
  winningOutcome: number | null;
  volume: string;
};

/** Full window selection shared by every window query. */
const WINDOW_FIELDS = `id handle { id symbol name aura categories windowMinutes sources metadata } oracle question style windowStart windowEnd
    outcomes initialProbabilities prices q liquidity strike settled winningOutcome volume`;

/** Protocol counters (one Stats entity — no client-side scanning). */
export type IndexerStats = {
  id: string;
  handleCount: number;
  windowCount: number;
  openWindows: number;
  totalVolume: string;
  totalCash: string;
};

export type IndexerTrade = {
  id: string;
  user: { id: string };
  outcome: number;
  kind: string;
  premium: string;
  proceeds: string;
  shares: string;
  price: string;
  ts: string;
};

export type IndexerOrder = {
  id: string;
  maker: { id: string };
  outcome: number;
  side: boolean;
  price: string;
  size: string;
  filled: string;
  status: string;
  createdAt: string;
};

export type IndexerOrderFill = {
  id: string;
  order: { id: string };
  taker: { id: string };
  outcome: number;
  shares: string;
  price: string;
  ts: string;
};

/** One LMSR price vector (1e18 per outcome) captured at a trade. */
export type IndexerPricePoint = {
  ts: string;
  prices: string[];
};

const STATS_QUERY = `{
  Stats_by_pk(id: "stats") { handleCount windowCount openWindows totalVolume totalCash }
}`;

/** Protocol Stats entity (null until the first indexed event seeds it). */
export const statsQueryOptions = queryOptions({
  queryKey: qk.stats,
  queryFn: async () => (await gql<{ Stats_by_pk: IndexerStats | null }>(STATS_QUERY)).Stats_by_pk,
  staleTime: 10_000,
  // No poll: the Stats subscription keeps this fresh.
});

/** Keep the protocol counters fresh — a single row, patched in place. */
export function useStatsLive(): boolean {
  return useIndexerLive<{ Stats_by_pk: IndexerStats | null }>({
    queryKey: qk.stats,
    query: `subscription {
      Stats_by_pk(id: "stats") { handleCount windowCount openWindows totalVolume totalCash }
    }`,
    mode: "patch",
    apply: (payload) => payload.Stats_by_pk,
  });
}

/** Every window for one handle — the live market first, then finished ones. */
export function handleWindowsOptions(handleId: string | undefined) {
  return queryOptions({
    queryKey: qk.handleWindows(handleId ?? ""),
    queryFn: async () =>
      (
        await gql<{ Window: IndexerWindow[] }>(
          `query($id: String!) {
            Window(where: { handle_id: { _eq: $id } }, order_by: { windowStart: desc }, limit: 30) {
              ${WINDOW_FIELDS}
            }
          }`,
          { id: handleId },
        )
      ).Window,
    enabled: !!handleId,
    staleTime: 3_000,
    // No poll: window open/resolve push messages invalidate this live.
  });
}

/** Keep one handle's window list fresh — window open / resolve. */
export function useHandleWindowsLive(handleId: string | undefined): boolean {
  return useIndexerLive<{ Window: IndexerWindow[] }>({
    queryKey: qk.handleWindows(handleId ?? ""),
    query: `subscription($id: String!) {
      Window(where: { handle_id: { _eq: $id } }, order_by: { windowStart: desc }, limit: 30) {
        ${WINDOW_FIELDS}
      }
    }`,
    variables: { id: handleId },
    enabled: !!handleId,
  });
}

/** Full price vectors for one window, oldest first — the chart's real source. */
export function windowPricePointsOptions(windowId: string | undefined) {
  return queryOptions({
    queryKey: qk.windowPoints(windowId ?? ""),
    queryFn: async () =>
      (
        await gql<{ PricePoint: IndexerPricePoint[] }>(
          `query($id: String!) {
            PricePoint(where: { window_id: { _eq: $id } }, order_by: { ts: asc }, limit: 500) {
              ts prices
            }
          }`,
          { id: windowId },
        )
      ).PricePoint,
    enabled: !!windowId,
    staleTime: 5_000,
    // No poll: the PricePoint subscription keeps this fresh.
  });
}

/** Keep the price-history chart fresh as each trade mints a new point. */
export function useWindowPointsLive(windowId: string | undefined): boolean {
  return useIndexerLive<{ PricePoint: IndexerPricePoint[] }>({
    queryKey: qk.windowPoints(windowId ?? ""),
    query: `subscription($id: String!) {
      PricePoint(where: { window_id: { _eq: $id } }, order_by: { ts: asc }, limit: 500) {
        ts prices
      }
    }`,
    variables: { id: windowId },
    enabled: !!windowId,
  });
}

/**
 * Trades on one window — the live tape. Filtered and ordered by the indexer
 * (`window_id`, `order_by: { ts: desc }`) and PAGED: each page asks for
 * `offset`, and `hasMore` is simply "the page came back full".
 */
export const TRADES_PAGE_SIZE = 25;

export function windowTradesOptions(windowId: string | undefined) {
  return infiniteQueryOptions({
    queryKey: qk.windowTrades(windowId ?? ""),
    queryFn: async ({ pageParam }) => {
      const trades = (
        await gql<{ Trade: IndexerTrade[] }>(
          `query($id: String!, $offset: Int!) {
            Trade(
              where: { window_id: { _eq: $id } }
              order_by: { ts: desc }
              limit: ${TRADES_PAGE_SIZE}
              offset: $offset
            ) {
              id user { id } outcome kind premium proceeds shares price ts
            }
          }`,
          { id: windowId, offset: pageParam },
        )
      ).Trade;
      return {
        items: trades,
        hasMore: trades.length >= TRADES_PAGE_SIZE,
        nextSkip: pageParam + trades.length,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (last: { hasMore: boolean; nextSkip: number }) =>
      last.hasMore ? last.nextSkip : undefined,
    enabled: !!windowId,
    staleTime: 5_000,
    // No poll: the Trade subscription keeps this fresh.
  });
}

/** Keep the live tape fresh as fills land. */
export function useWindowTradesLive(windowId: string | undefined): boolean {
  return useIndexerLive<{ Trade: IndexerTrade[] }>({
    queryKey: qk.windowTrades(windowId ?? ""),
    query: `subscription($id: String!) {
      Trade(where: { window_id: { _eq: $id } }, order_by: { ts: desc }, limit: ${TRADES_PAGE_SIZE}) {
        id user { id } outcome kind premium proceeds shares price ts
      }
    }`,
    variables: { id: windowId },
    enabled: !!windowId,
  });
}

/** Active orders + recent fills for one window (orderbook raw material). */
export function orderbookOptions(windowId: string | undefined) {
  return queryOptions({
    queryKey: qk.orderbook(windowId ?? ""),
    queryFn: async () => {
      const data = await gql<{ Order: IndexerOrder[]; OrderFill: IndexerOrderFill[] }>(
        `query($id: String!) {
          Order(where: { window_id: { _eq: $id }, status: { _eq: "ACTIVE" } }, limit: 500, order_by: { price: asc }) {
            id maker { id } outcome side price size filled status createdAt
          }
          OrderFill(where: { window_id: { _eq: $id } }, limit: 50, order_by: { ts: desc }) {
            id order { id } taker { id } outcome shares price ts
          }
        }`,
        { id: windowId },
      );
      return buildBook(data.Order, data.OrderFill);
    },
    enabled: !!windowId,
    staleTime: 3_000,
    // No poll: the Order/OrderFill subscription keeps this fresh.
  });
}

/**
 * Keep the order book fresh — a single row, so the subscription patches the
 * cache by re-aggregating the payload through the same client-side transform.
 */
export function useOrderbookLive(windowId: string | undefined): boolean {
  return useIndexerLive<{ Order: IndexerOrder[]; OrderFill: IndexerOrderFill[] }>({
    queryKey: qk.orderbook(windowId ?? ""),
    query: `subscription($id: String!) {
      Order(where: { window_id: { _eq: $id }, status: { _eq: "ACTIVE" } }, limit: 500, order_by: { price: asc }) {
        id maker { id } outcome side price size filled status createdAt
      }
      OrderFill(where: { window_id: { _eq: $id } }, limit: 50, order_by: { ts: desc }) {
        id order { id } taker { id } outcome shares price ts
      }
    }`,
    variables: { id: windowId },
    enabled: !!windowId,
    mode: "patch",
    apply: (payload) => buildBook(payload.Order, payload.OrderFill),
  });
}

export type BookLevel = { price: string; size: string };
export type OutcomeBook = { outcome: number; label: string; bids: BookLevel[]; asks: BookLevel[] };
export type Orderbook = { books: OutcomeBook[]; fills: IndexerOrderFill[]; orders: number };

/** Aggregate resting orders into per-outcome ladders (client-side transform). */
export function buildBook(
  orders: IndexerOrder[],
  fills: IndexerOrderFill[],
  outcomes?: string[],
): Orderbook {
  const levels = new Map<number, { bids: Map<string, bigint>; asks: Map<string, bigint> }>();
  for (const o of orders) {
    const remaining = BigInt(o.size) - BigInt(o.filled);
    if (remaining <= 0n) continue;
    let book = levels.get(o.outcome);
    if (!book) {
      book = { bids: new Map(), asks: new Map() };
      levels.set(o.outcome, book);
    }
    const side = o.side ? book.bids : book.asks;
    side.set(o.price, (side.get(o.price) ?? 0n) + remaining);
  }
  const toLevels = (m: Map<string, bigint>, dir: "asc" | "desc"): BookLevel[] =>
    [...m.entries()]
      .sort(([p1], [p2]) => (p1 === p2 ? 0 : (p1 < p2 ? -1 : 1) * (dir === "asc" ? 1 : -1)))
      .map(([price, size]) => ({ price, size: String(size) }));
  const books: OutcomeBook[] = [...levels.entries()]
    .sort(([a], [b]) => a - b)
    .map(([outcome, book]) => ({
      outcome,
      label: outcomes?.[outcome] ?? String(outcome),
      bids: toLevels(book.bids, "desc"),
      asks: toLevels(book.asks, "asc"),
    }));
  if (outcomes) {
    for (let i = 0; i < outcomes.length; i++) {
      if (!books.some((b) => b.outcome === i))
        books.push({ outcome: i, label: outcomes[i]!, bids: [], asks: [] });
    }
    books.sort((a, b) => a.outcome - b.outcome);
  }
  return { books, fills, orders: orders.length };
}

