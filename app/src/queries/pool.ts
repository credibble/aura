/**
 * Pool queries — the auraLP vault's history, read DIRECTLY from the indexer.
 * `PoolSnapshot` is written on every pool event (deposit, withdraw, reserve,
 * payout, unreserve) with the vault's state at that block, so the charts are the
 * real reserve/idle/supply series — nothing interpolated.
 */
import { queryOptions } from "@tanstack/react-query";
import { gql } from "@/lib/graphql";
import { useIndexerLive } from "@/lib/indexer-ws";
import { qk } from "./keys";

export type IndexerPoolSnapshot = {
  id: string;
  pool: string;
  blockNumber: string;
  timestamp: string;
  totalReserved: string;
  idle: string;
  totalSupply: string;
  totalAssets: string;
  valuePerToken: string;
};

export type IndexerPoolEvent = {
  id: string;
  pool: string;
  oracle: string;
  kind: "RESERVED" | "PAID_OUT" | "UNRESERVED";
  amount: string;
  to: string | null;
  timestamp: string;
};

const SNAPSHOT_FIELDS = `id pool blockNumber timestamp totalReserved idle totalSupply totalAssets valuePerToken`;

/** Oldest → newest so the chart reads left to right. */
export const poolSnapshotsOptions = queryOptions({
  queryKey: qk.poolSnapshots,
  queryFn: async () =>
    (
      await gql<{ PoolSnapshot: IndexerPoolSnapshot[] }>(`{
        PoolSnapshot(order_by: { timestamp: asc }, limit: 1000) {
          ${SNAPSHOT_FIELDS}
        }
      }`)
    ).PoolSnapshot,
  staleTime: 10_000,
  // No poll: the PoolSnapshot subscription keeps this fresh.
});

/** Keep the vault chart fresh as each pool event writes a snapshot. */
export function usePoolSnapshotsLive(): boolean {
  return useIndexerLive<{ PoolSnapshot: IndexerPoolSnapshot[] }>({
    queryKey: qk.poolSnapshots,
    query: `subscription {
      PoolSnapshot(order_by: { timestamp: asc }, limit: 1000) {
        ${SNAPSHOT_FIELDS}
      }
    }`,
  });
}

/** Newest first — the vault's recent reserve/payout activity. */
export const poolEventsOptions = queryOptions({
  queryKey: qk.poolEvents,
  queryFn: async () =>
    (
      await gql<{ PoolEvent: IndexerPoolEvent[] }>(`{
        PoolEvent(order_by: { timestamp: desc }, limit: 40) {
          id pool oracle kind amount to timestamp
        }
      }`)
    ).PoolEvent,
  staleTime: 10_000,
  // No poll: the PoolEvent subscription keeps this fresh.
});

/** Keep the recent-flows table fresh as the vault is reserved/paid out. */
export function usePoolEventsLive(): boolean {
  return useIndexerLive<{ PoolEvent: IndexerPoolEvent[] }>({
    queryKey: qk.poolEvents,
    query: `subscription {
      PoolEvent(order_by: { timestamp: desc }, limit: 40) {
        id pool oracle kind amount to timestamp
      }
    }`,
  });
}
