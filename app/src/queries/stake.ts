/**
 * Stake queries — AURA staked on a handle, read DIRECTLY from the subgraph.
 * `Stake` is the per-handle vault's current state and `StakeSnapshot` is written
 * on every deposit/withdraw/reward, so the history is real (no RPC needed for
 * anything the charts show).
 */
import { queryOptions } from "@tanstack/react-query";
import { gql } from "@/lib/graphql";
import { qk } from "./keys";

export type SubgraphStake = {
  id: string;
  contract: string;
  handle: { id: string; name: string | null; symbol: string | null };
  totalSupply: string;
  totalAssets: string;
  valuePerToken: string;
};

export type SubgraphStakeSnapshot = {
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
        await gql<{ stakes: SubgraphStake[] }>(
          `query($id: ID!) {
            stakes(where: { id: $id }, first: 1) {
              id contract totalSupply totalAssets valuePerToken
              handle { id name symbol }
            }
          }`,
          { id: stakeAddress },
        )
      ).stakes[0] ?? null,
    enabled: !!stakeAddress,
    staleTime: 10_000,
  });
}

/** Oldest → newest, for the stake chart. */
export function stakeSnapshotsOptions(stakeAddress: string | undefined) {
  return queryOptions({
    queryKey: qk.stakeSnapshots(stakeAddress ?? ""),
    queryFn: async () =>
      (
        await gql<{ stakeSnapshots: SubgraphStakeSnapshot[] }>(
          `query($id: String!) {
            stakeSnapshots(
              where: { stake: $id }
              orderBy: timestamp
              orderDirection: asc
              first: 500
            ) { id timestamp totalSupply totalAssets valuePerToken }
          }`,
          { id: stakeAddress },
        )
      ).stakeSnapshots,
    enabled: !!stakeAddress,
    staleTime: 10_000,
  });
}
