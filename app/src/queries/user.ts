/**
 * Wallet-scoped indexer queries — the signed-in account's own handles,
 * resting orders and trade history (positions are derived from real trades;
 * nothing is synthesized). All read directly from the indexer.
 */
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { gql } from "@/lib/graphql";
import { useIndexerLive } from "@/lib/indexer-ws";
import { qk } from "./keys";
import type { IndexerHandle } from "./handles";

const OWNED_WINDOW_FIELDS = `id question outcomes prices settled winningOutcome windowStart windowEnd oracle volume handle { id name symbol aura }`;

/** Window fields joined into the wallet's trades + orders. */
export type PositionWindow = {
  id: string;
  question: string;
  outcomes: string[];
  prices: string[];
  settled: boolean;
  winningOutcome: number | null;
  windowStart: string;
  windowEnd: string;
  oracle: string;
  volume: string;
  handle: { id: string; name: string | null; symbol: string | null; aura: string };
};

export type PositionTrade = {
  id: string;
  outcome: number;
  kind: string;
  /** USDC, 1e18 wei. */
  premium: string;
  /** USDC, 1e18 wei. */
  proceeds: string;
  /** Outcome-token shares, 1e18 wei — divide by 1e18 for human shares. */
  shares: string;
  price: string;
  ts: string;
  window: PositionWindow;
};

/** Handles created (owned) by a wallet address. */
export function userHandlesOptions(address: string | undefined) {
  return queryOptions({
    queryKey: qk.userHandles(address?.toLowerCase() ?? ""),
    queryFn: async () =>
      (
        await gql<{ Handle: IndexerHandle[] }>(
          `query($owner: String!) {
            Handle(where: { owner_id: { _eq: $owner }, active: { _eq: true } }, order_by: { aura: desc }, limit: 50) {
              id contract stake name symbol metadata sources aura auraDelta graduated verified categories windowMinutes active windowCount
              auraHistory(limit: 64, order_by: { timestamp: desc }) { aura summary timestamp }
              windows(limit: 1, order_by: { windowStart: desc }) {
                id windowStart windowEnd outcomes settled prices volume
              }
            }
          }`,
          { owner: address!.toLowerCase() },
        )
      ).Handle,
    enabled: !!address,
    staleTime: 10_000,
    // No poll: aura/handle push messages invalidate this live.
  });
}

/** The account's trade history, newest first — the raw material for positions. */
export function positionsOptions(address: string | undefined) {
  return queryOptions({
    queryKey: qk.positions(address?.toLowerCase() ?? ""),
    queryFn: async () =>
      (
        await gql<{ Trade: PositionTrade[] }>(
          `query($user: String!) {
            Trade(where: { user_id: { _eq: $user } }, order_by: { ts: desc }, limit: 500) {
              id outcome kind premium proceeds shares price ts
              window { ${OWNED_WINDOW_FIELDS} }
            }
          }`,
          { user: address!.toLowerCase() },
        )
      ).Trade,
    enabled: !!address,
    staleTime: 5_000,
    // No poll: the Trade subscription keeps this fresh.
  });
}

/** Keep the account's position history fresh as it trades. */
export function usePositionsLive(address: string | undefined): boolean {
  const user = address?.toLowerCase();
  return useIndexerLive<{ Trade: PositionTrade[] }>({
    queryKey: qk.positions(user ?? ""),
    query: `subscription($user: String!) {
      Trade(where: { user_id: { _eq: $user } }, order_by: { ts: desc }, limit: 500) {
        id outcome kind premium proceeds shares price ts
        window { ${OWNED_WINDOW_FIELDS} }
      }
    }`,
    variables: { user },
    enabled: !!address,
  });
}

export type OpenOrder = {
  id: string;
  outcome: number;
  side: boolean;
  price: string;
  size: string;
  filled: string;
  /** ACTIVE | FILLED | CANCELLED. */
  status: string;
  expiresAt: string;
  createdAt: string;
  window: {
    id: string;
    question: string;
    outcomes: string[];
    windowEnd: string;
    oracle: string;
    handle: { id: string };
  };
};

/** The account's resting limit orders (open on the order book). */
export function openOrdersOptions(address: string | undefined) {
  return queryOptions({
    queryKey: qk.openOrders(address?.toLowerCase() ?? ""),
    queryFn: async () =>
      (
        await gql<{ Order: OpenOrder[] }>(
          `query($maker: String!) {
            Order(where: { maker_id: { _eq: $maker }, status: { _eq: "ACTIVE" } }, order_by: { createdAt: desc }, limit: 100) {
              id outcome side price size filled status expiresAt createdAt
              window { id question outcomes windowEnd oracle handle { id } }
            }
          }`,
          { maker: address!.toLowerCase() },
        )
      ).Order,
    enabled: !!address,
    staleTime: 5_000,
    // No poll: the Order subscription keeps this fresh.
  });
}

/** Keep the account's resting orders fresh as the book changes. */
export function useOpenOrdersLive(address: string | undefined): boolean {
  const maker = address?.toLowerCase();
  return useIndexerLive<{ Order: OpenOrder[] }>({
    queryKey: qk.openOrders(maker ?? ""),
    query: `subscription($maker: String!) {
      Order(where: { maker_id: { _eq: $maker }, status: { _eq: "ACTIVE" } }, order_by: { createdAt: desc }, limit: 100) {
        id outcome side price size filled status expiresAt createdAt
        window { id question outcomes windowEnd oracle handle { id } }
      }
    }`,
    variables: { maker },
    enabled: !!address,
  });
}

export type OrderTab = "open" | "closed";

/** Rows per page in the portfolio's numbered order tables. */
export const ORDERS_PAGE_SIZE = 8;

/**
 * One numbered page of the wallet's orders.
 *
 * The page itself is a real indexer slice (`limit`/`offset`). Envio exposes no
 * COUNT/`_aggregate` (verified against the live schema), so the exact total for
 * the pager comes from a second id-only field in the SAME round trip — cheap
 * for a single wallet. Closed = anything not ACTIVE (FILLED | CANCELLED).
 */
export function ordersPageOptions(
  address: string | undefined,
  tab: OrderTab,
  page: number,
  pageSize = ORDERS_PAGE_SIZE,
) {
  const maker = address?.toLowerCase() ?? "";
  const status = tab === "open" ? `{ _eq: "ACTIVE" }` : `{ _neq: "ACTIVE" }`;
  const offset = (Math.max(1, page) - 1) * pageSize;
  const fields = `id outcome side price size filled status expiresAt createdAt
    window { id question outcomes windowEnd oracle handle { id } }`;
  return queryOptions({
    queryKey: qk.ordersPage(maker, tab, page),
    queryFn: async () => {
      const data = await gql<{ page: OpenOrder[]; all: { id: string }[] }>(
        `query Orders($maker: String!) {
          page: Order(where: { maker_id: { _eq: $maker }, status: ${status} }, order_by: { createdAt: desc }, limit: ${pageSize}, offset: ${offset}) {
            ${fields}
          }
          all: Order(where: { maker_id: { _eq: $maker }, status: ${status} }, limit: 1000) { id }
        }`,
        { maker },
      );
      return { items: data.page ?? [], total: (data.all ?? []).length };
    },
    enabled: !!address,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });
}
