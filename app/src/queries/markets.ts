/**
 * Market queries — windows, orderbook, trades and price history read DIRECTLY
 * from the subgraph (the frontend transforms the data itself; no backend proxy).
 * The ladder is built client-side from resting ACTIVE orders + recent fills;
 * the chart is built from per-trade PricePoint snapshots (full LMSR vectors).
 */
import { infiniteQueryOptions, queryOptions, useQuery } from "@tanstack/react-query";
import { gql } from "@/lib/graphql";
import { qk } from "./keys";

export type SubgraphWindow = {
  id: string;
  handle: {
    id: string;
    symbol: string | null;
    name: string | null;
    aura: string;
    /** On-chain category codes (100_001_001 → family codes). */
    categories: string[];
    /** Family ids derived from the codes — `["sports"]`. */
    categoryIds: string[];
    windowMinutes: string;
    /** Adapter source JSON configs (the real outlets behind the index). */
    sources: string[];
    /** Raw on-chain metadata JSON — carries the handle's `photo`. */
    metadata?: string | null;
  };
  oracle: string;
  /** Parsed window metadata (subgraph decodes Oracle.metadata). */
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
  reference: string;
  settled: boolean;
  winningOutcome: number | null;
  volume: string;
};

/** Full window selection shared by every window query. */
const WINDOW_FIELDS = `id handle { id symbol name aura categories categoryIds windowMinutes sources metadata } oracle question style windowStart windowEnd
    outcomes initialProbabilities prices q liquidity reference settled winningOutcome volume`;

/** Protocol counters (one Stats entity — no client-side scanning). */
export type SubgraphStats = {
  id: string;
  handleCount: number;
  windowCount: number;
  openWindows: number;
  totalVolume: string;
  totalCash: string;
};

export type SubgraphTrade = {
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

export type SubgraphOrder = {
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

export type SubgraphOrderFill = {
  id: string;
  order: { id: string };
  taker: { id: string };
  outcome: number;
  shares: string;
  price: string;
  ts: string;
};

/** One LMSR price vector (1e18 per outcome) captured at a trade. */
export type SubgraphPricePoint = {
  ts: string;
  prices: string[];
};

const WINDOWS_QUERY = `{
  windows(where: { settled: false }, orderBy: windowStart, orderDirection: desc, first: 100) {
    ${WINDOW_FIELDS}
  }
}`;

export const windowsQueryOptions = queryOptions({
  queryKey: qk.windows,
  queryFn: async () => (await gql<{ windows: SubgraphWindow[] }>(WINDOWS_QUERY)).windows,
  staleTime: 5_000,
  // No poll: `window.opened`/`window` push messages invalidate windows live.
});

const STATS_QUERY = `{
  stats(id: "stats") { handleCount windowCount openWindows totalVolume totalCash }
}`;

/** Protocol Stats entity (null until the first indexed event seeds it). */
export const statsQueryOptions = queryOptions({
  queryKey: qk.stats,
  queryFn: async () => (await gql<{ stats: SubgraphStats | null }>(STATS_QUERY)).stats,
  staleTime: 10_000,
  meta: { pollMs: 15_000 },
});

/** Every window for one handle — the live market first, then finished ones. */
export function handleWindowsOptions(handleId: string | undefined) {
  return queryOptions({
    queryKey: qk.handleWindows(handleId ?? ""),
    queryFn: async () =>
      (
        await gql<{ windows: SubgraphWindow[] }>(
          `query($id: String!) {
            windows(where: { handle: $id }, orderBy: windowStart, orderDirection: desc, first: 30) {
              ${WINDOW_FIELDS}
            }
          }`,
          { id: handleId },
        )
      ).windows,
    enabled: !!handleId,
    staleTime: 3_000,
    // No poll: window open/resolve push messages invalidate this live.
  });
}

export function windowOptions(windowId: string | undefined) {
  return queryOptions({
    queryKey: qk.window(windowId ?? ""),
    queryFn: async () =>
      (
        await gql<{ windows: SubgraphWindow[] }>(
          `query($id: ID!) { windows(where: { id: $id }) { ${WINDOW_FIELDS} } }`,
          { id: windowId },
        )
      ).windows[0] ?? null,
    enabled: !!windowId,
    staleTime: 3_000,
    meta: { pollMs: 10_000 },
  });
}

/** Full price vectors for one window, oldest first — the chart's real source. */
export function windowPricePointsOptions(windowId: string | undefined) {
  return queryOptions({
    queryKey: qk.windowPoints(windowId ?? ""),
    queryFn: async () =>
      (
        await gql<{ pricePoints: SubgraphPricePoint[] }>(
          `query($id: ID!) {
            pricePoints(where: { window: $id }, orderBy: ts, orderDirection: asc, first: 500) {
              ts prices
            }
          }`,
          { id: windowId },
        )
      ).pricePoints,
    enabled: !!windowId,
    staleTime: 5_000,
    meta: { pollMs: 15_000 },
  });
}

/**
 * Trades on one window — the live tape. Filtered and ordered by the subgraph
 * (`where.window`, `orderBy ts desc`) and PAGED: each page asks for `skip`, and
 * `hasMore` is simply "the page came back full".
 */
export const TRADES_PAGE_SIZE = 25;

export function windowTradesOptions(windowId: string | undefined) {
  return infiniteQueryOptions({
    queryKey: qk.windowTrades(windowId ?? ""),
    queryFn: async ({ pageParam }) => {
      const trades = (
        await gql<{ trades: SubgraphTrade[] }>(
          `query($id: ID!, $skip: Int!) {
            trades(
              where: { window: $id }
              orderBy: ts
              orderDirection: desc
              first: ${TRADES_PAGE_SIZE}
              skip: $skip
            ) {
              id user { id } outcome kind premium proceeds shares price ts
            }
          }`,
          { id: windowId, skip: pageParam },
        )
      ).trades;
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
    meta: { pollMs: 15_000 },
  });
}

/** Active orders + recent fills for one window (orderbook raw material). */
export function orderbookOptions(windowId: string | undefined) {
  return queryOptions({
    queryKey: qk.orderbook(windowId ?? ""),
    queryFn: async () => {
      const data = await gql<{ orders: SubgraphOrder[]; orderFills: SubgraphOrderFill[] }>(
        `query($id: ID!) {
          orders(where: { window: $id, status: "ACTIVE" }, first: 500, orderBy: price, orderDirection: asc) {
            id maker { id } outcome side price size filled status createdAt
          }
          orderFills(where: { window: $id }, first: 50, orderBy: ts, orderDirection: desc) {
            id order { id } taker { id } outcome shares price ts
          }
        }`,
        { id: windowId },
      );
      return buildBook(data.orders, data.orderFills);
    },
    enabled: !!windowId,
    staleTime: 3_000,
    meta: { pollMs: 10_000 },
  });
}

export type BookLevel = { price: string; size: string };
export type OutcomeBook = { outcome: number; label: string; bids: BookLevel[]; asks: BookLevel[] };
export type Orderbook = { books: OutcomeBook[]; fills: SubgraphOrderFill[]; orders: number };

/** Aggregate resting orders into per-outcome ladders (client-side transform). */
export function buildBook(
  orders: SubgraphOrder[],
  fills: SubgraphOrderFill[],
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

export function useWindows() {
  return useQuery(windowsQueryOptions);
}
