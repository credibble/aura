/**
 * Pool queries — the auraLP vault's history, read DIRECTLY from the subgraph.
 * `PoolSnapshot` is written on every pool event (deposit, withdraw, reserve,
 * payout, unreserve) with the vault's state at that block, so the charts are the
 * real reserve/idle/supply series — nothing interpolated.
 */
import { queryOptions } from "@tanstack/react-query";
import { gql } from "@/lib/graphql";
import { qk } from "./keys";

export type SubgraphPoolSnapshot = {
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

export type SubgraphPoolEvent = {
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
      await gql<{ poolSnapshots: SubgraphPoolSnapshot[] }>(`{
        poolSnapshots(orderBy: timestamp, orderDirection: asc, first: 1000) {
          ${SNAPSHOT_FIELDS}
        }
      }`)
    ).poolSnapshots,
  staleTime: 10_000,
  // No poll: pool push messages invalidate this live.
});

/** Newest first — the vault's recent reserve/payout activity. */
export const poolEventsOptions = queryOptions({
  queryKey: qk.poolEvents,
  queryFn: async () =>
    (
      await gql<{ poolEvents: SubgraphPoolEvent[] }>(`{
        poolEvents(orderBy: timestamp, orderDirection: desc, first: 40) {
          id pool oracle kind amount to timestamp
        }
      }`)
    ).poolEvents,
  staleTime: 10_000,
});
