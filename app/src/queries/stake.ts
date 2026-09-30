/**
 * Stake queries — AURA staked on a handle, read DIRECTLY from the indexer.
 * `Stake` is the per-handle vault's current state and `StakeSnapshot` is written
 * on every deposit/withdraw/reward, so the history is real (no RPC needed for
 * anything the charts show).
 */
import { queryOptions } from "@tanstack/react-query";
import { gql } from "@/lib/graphql";
import { useIndexerLive } from "@/lib/indexer-ws";
import { qk } from "./keys";

export type IndexerStake = {
  id: string;
  contract: string;
  handle: { id: string; name: string | null; symbol: string | null };
  totalSupply: string;
  totalAssets: string;
  valuePerToken: string;
};

export type IndexerStakeSnapshot = {
  id: string;
  timestamp: string;
  totalSupply: string;
  totalAssets: string;
  valuePerToken: string;
};

/** Current vault state for one handle (keyed by the stake address). */
export function stakeOptions(stakeAddress: string | undefined) {
  return queryOptions({
    queryKey: qk.stake("stats", stakeAddress ?? ""),
    queryFn: async () =>
      (
        await gql<{ Stake_by_pk: IndexerStake | null }>(
          `query($id: String!) {
            Stake_by_pk(id: $id) {
              id contract totalSupply totalAssets valuePerToken
              handle { id name symbol }
            }
          }`,
          { id: stakeAddress },
        )
      ).Stake_by_pk ?? null,
    enabled: !!stakeAddress,
    staleTime: 10_000,
    // No poll: the Stake subscription keeps this fresh.
  });
}

/** Keep the handle's staked total fresh — a single row, patched in place. */
export function useStakeLive(stakeAddress: string | undefined): boolean {
  return useIndexerLive<{ Stake_by_pk: IndexerStake | null }>({
    queryKey: qk.stake("stats", stakeAddress ?? ""),
    query: `subscription($id: String!) {
      Stake_by_pk(id: $id) {
        id contract totalSupply totalAssets valuePerToken
        handle { id name symbol }
      }
    }`,
    variables: { id: stakeAddress },
    enabled: !!stakeAddress,
    mode: "patch",
    apply: (payload) => payload.Stake_by_pk,
  });
}

/** Oldest → newest, for the stake chart. */
export function stakeSnapshotsOptions(stakeAddress: string | undefined) {
  return queryOptions({
    queryKey: qk.stakeSnapshots(stakeAddress ?? ""),
    queryFn: async () =>
      (
        await gql<{ StakeSnapshot: IndexerStakeSnapshot[] }>(
          `query($id: String!) {
            StakeSnapshot(
              where: { stake_id: { _eq: $id } }
              order_by: { timestamp: asc }
              limit: 500
            ) { id timestamp totalSupply totalAssets valuePerToken }
          }`,
          { id: stakeAddress },
        )
      ).StakeSnapshot,
    enabled: !!stakeAddress,
    staleTime: 10_000,
    // No poll: the StakeSnapshot subscription keeps this fresh.
  });
}

/** Keep the stake history chart fresh as deposits/withdrawals land. */
export function useStakeSnapshotsLive(stakeAddress: string | undefined): boolean {
  return useIndexerLive<{ StakeSnapshot: IndexerStakeSnapshot[] }>({
    queryKey: qk.stakeSnapshots(stakeAddress ?? ""),
    query: `subscription($id: String!) {
      StakeSnapshot(
        where: { stake_id: { _eq: $id } }
        order_by: { timestamp: asc }
        limit: 500
      ) { id timestamp totalSupply totalAssets valuePerToken }
    }`,
    variables: { id: stakeAddress },
    enabled: !!stakeAddress,
  });
}
