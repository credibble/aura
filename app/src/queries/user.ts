/**
 * Wallet-scoped subgraph queries — the signed-in account's own handles,
 * resting orders and trade history (positions are derived from real trades;
 * nothing is synthesized). All read directly from the subgraph.
 */
import { queryOptions } from "@tanstack/react-query";
import { gql } from "@/lib/graphql";
import { qk } from "./keys";
import type { SubgraphHandle } from "./handles";

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
  premium: string;
  proceeds: string;
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
        await gql<{ handles: SubgraphHandle[] }>(
          `query($owner: String!) {
            handles(where: { owner: $owner, active: true }, orderBy: aura, orderDirection: desc, first: 50) {
              id contract stake name symbol metadata sources aura auraDelta graduated verified category windowMinutes active windowCount
              auraHistory(first: 64, orderBy: timestamp, orderDirection: desc) { aura summary timestamp }
              windows(first: 1, orderBy: windowStart, orderDirection: desc) {
                id windowStart windowEnd outcomes settled prices volume
              }
            }
          }`,
          { owner: address!.toLowerCase() },
        )
      ).handles,
    enabled: !!address,
    staleTime: 10_000,
    meta: { pollMs: 15_000 },
  });
}

/** The account's trade history, newest first — the raw material for positions. */
export function positionsOptions(address: string | undefined) {
  return queryOptions({
    queryKey: qk.positions(address?.toLowerCase() ?? ""),
    queryFn: async () =>
      (
        await gql<{ trades: PositionTrade[] }>(
          `query($user: String!) {
            trades(where: { user: $user }, orderBy: ts, orderDirection: desc, first: 500) {
              id outcome kind premium proceeds shares price ts
              window { ${OWNED_WINDOW_FIELDS} }
            }
          }`,
          { user: address!.toLowerCase() },
        )
      ).trades,
    enabled: !!address,
    staleTime: 5_000,
    meta: { pollMs: 15_000 },
  });
}

export type OpenOrder = {
  id: string;
  outcome: number;
  side: boolean;
  price: string;
  size: string;
  filled: string;
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
        await gql<{ orders: OpenOrder[] }>(
          `query($maker: String!) {
            orders(where: { maker: $maker, status: "ACTIVE" }, orderBy: createdAt, orderDirection: desc, first: 100) {
              id outcome side price size filled expiresAt createdAt
              window { id question outcomes windowEnd oracle handle { id } }
            }
          }`,
          { maker: address!.toLowerCase() },
        )
      ).orders,
    enabled: !!address,
    staleTime: 5_000,
    meta: { pollMs: 15_000 },
  });
}
