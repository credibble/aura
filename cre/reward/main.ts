/**
 * Aura stake-rewarding Chainlink CRE workflow.
 *
 * A cron-triggered workflow that rewards each handle's stakers: on schedule it
 * reads every handle's Stake receipt (resolved off-chain from the indexer and
 * supplied via `config.stakeAddresses`), checks the vault's AURA balance, and —
 * when it has dipped below the target — approves AURA and calls
 * `Stake.rewardAura(amount)` with the protocol treasury signer.
 *
 * Built with the CRE SDK (code-first, compiled to WASM by the `cre` CLI):
 *   cre workflow build ./stake-reward --target staging-settings
 *   cre workflow simulate aura-stake-reward-staging --target staging-settings
 *   cre workflow deploy aura-stake-reward-production --target production-settings
 */
import {
  CronCapability,
  handler,
  Runner,
  type Runtime,
} from "@chainlink/cre-sdk";

type Config = {
  /** Cron schedule (6-hourly by default). */
  schedule: string;
  /** The AURA token contract address. */
  auraTokenAddress: string;
  /** Every handle's Stake receipt (from the indexer's Handle.stake). */
  stakeAddresses: string[];
  /** Amount (wei) to reward to each stake vault per run. */
  rewardAmount: string;
  /** Skip a vault when its balance is already above this amount (wei). */
  skipIfBalanceAbove: string;
};

const AURA_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;
const STAKE_ABI = ["function reward(uint256 amount, string memo)"] as const;

const onCron = (runtime: Runtime<Config>): string => {
  const { auraTokenAddress, stakeAddresses, rewardAmount, skipIfBalanceAbove } =
    runtime.config;
  const evm = runtime.evm;

  for (const stake of stakeAddresses) {
    const balance = evm
      .readContract(runtime, {
        address: auraTokenAddress,
        abi: AURA_ABI,
        functionName: "balanceOf",
        args: [stake],
      })
      .result();

    if (BigInt(balance) >= BigInt(skipIfBalanceAbove)) {
      runtime.log(`CRE: ${stake} already funded — skipping`);
      continue;
    }

    // Approve the Stake vault, then reward — each is a consensus-verified EVM write.
    evm
      .writeContract(runtime, {
        address: auraTokenAddress,
        abi: AURA_ABI,
        functionName: "approve",
        args: [stake, rewardAmount],
      })
      .result();
    evm
      .writeContract(runtime, {
        address: stake,
        abi: STAKE_ABI,
        functionName: "reward",
        args: [rewardAmount, "CRE reward"],
      })
      .result();

    runtime.log(`CRE: rewarded ${rewardAmount} AURA to stakers of ${stake}`);
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
