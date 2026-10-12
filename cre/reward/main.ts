/**
 * Aura stake-rewarding Chainlink CRE workflow.
 *
 * A cron-triggered workflow that rewards each handle's stakers: on schedule it
 * reads every handle's Stake vault from the Envio indexer (the HyperSync-synced
 * chain index the app and the oracle already read) — both the list of vaults
 * AND their current AURA balance come from one indexed query — and, when a
 * vault has dipped below the target, approves AURA and calls
 * `Stake.reward(amount, memo)` with the protocol treasury signer.
 *
 * Reads go through Envio (HyperSync primary, HyperRPC fallback underneath),
 * never a raw RPC scan: `Stake.totalAssets` is exactly `aura.balanceOf(vault)`
 * (Stake.sol totalAssets) and the indexer refreshes it on every
 * `StakeStateChanged`. Writes are consensus-verified EVM calls.
 *
 * Built with the CRE SDK (code-first, compiled to WASM by the `cre` CLI).
 * One target — Monad testnet, no mainnet/production:
 *   cre workflow build ./reward --target testnet-settings
 *   cre workflow simulate aura-stake-reward-testnet --target testnet-settings
 *   cre workflow deploy aura-stake-reward-testnet --target testnet-settings
 */
import {
  CronCapability,
  HttpCapability,
  handler,
  Runner,
  type Runtime,
} from "@chainlink/cre-sdk";

type Config = {
  /** Cron schedule (6-hourly by default). */
  schedule: string;
  /** The Envio indexer GraphQL endpoint — HyperSync-backed, `/v1/graphql`. */
  indexerUrl: string;
  /** The AURA token contract address (used for the approve write). */
  auraTokenAddress: string;
  /** Amount (wei) to reward to each stake vault per run. */
  rewardAmount: string;
  /** Skip a vault when its indexed AURA balance is already above this amount (wei). */
  skipIfBalanceAbove: string;
};

const AURA_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;
const STAKE_ABI = ["function reward(uint256 amount, string memo)"] as const;

/**
 * Every per-handle stake vault plus its live AURA balance, straight from the
 * index — Envio's own dialect (`order_by`, `_eq`-style filters), the same
 * shape the app's `queries/stake.ts` uses.
 */
const STAKES_QUERY = `
  query($limit: Int) {
    Stake(limit: $limit, order_by: { id: asc }) {
      id
      totalAssets
      handle { name }
    }
  }
`;

type IndexedStake = {
  id: string;
  totalAssets: string;
  handle: { name: string | null };
};

const onCron = (runtime: Runtime<Config>): string => {
  const { indexerUrl, auraTokenAddress, rewardAmount, skipIfBalanceAbove } =
    runtime.config;
  const evm = runtime.evm;

  // One consensus-verified HTTP read of the HyperSync-backed index: every
  // vault's address and its current AURA balance.
  const response = new HttpCapability()
    .request(runtime, {
      method: "POST",
      url: indexerUrl,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: STAKES_QUERY,
        variables: { limit: 200 },
      }),
    })
    .result();

  let stakes: IndexedStake[] = [];
  try {
    const parsed = JSON.parse(response);
    stakes = Array.isArray(parsed?.data?.Stake) ? parsed.data.Stake : [];
  } catch {
    runtime.log(`CRE: indexer response not parseable — skipping run`);
    return "reward-skip";
  }

  if (stakes.length === 0) {
    runtime.log(`CRE: indexer returned no stake vaults — skipping run`);
    return "reward-skip";
  }

  runtime.log(`CRE: ${stakes.length} stake vaults from ${indexerUrl}`);

  for (const stake of stakes) {
    if (BigInt(stake.totalAssets) >= BigInt(skipIfBalanceAbove)) {
      runtime.log(`CRE: ${stake.id} already funded — skipping`);
      continue;
    }

    // Approve the Stake vault, then reward — each is a consensus-verified EVM write.
    evm
      .writeContract(runtime, {
        address: auraTokenAddress,
        abi: AURA_ABI,
        functionName: "approve",
        args: [stake.id, rewardAmount],
      })
      .result();
    evm
      .writeContract(runtime, {
        address: stake.id,
        abi: STAKE_ABI,
        functionName: "reward",
        args: [rewardAmount, "CRE reward"],
      })
      .result();

    runtime.log(
      `CRE: rewarded ${rewardAmount} AURA to stakers of ${stake.id}` +
        (stake.handle.name ? ` (@${stake.handle.name})` : ""),
    );
  }

  return "stake-reward-complete";
};

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCron)];
};

export async function main(): Promise<void> {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
