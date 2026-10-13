import { ethers } from "hardhat";
import { readFileSync } from "node:fs";

/**
 * Fund the RewardConsumer with AURA so it can top up underfunded Stake vaults.
 *
 *   PRIVATE_KEY=$RELAYER_PK npx hardhat run scripts/fund-reward-consumer.ts --network monadTestnet
 *
 * Env (optional):
 *   FUND_AMOUNT  whole AURA to hold (default: 100000)
 *
 * Safe to re-run: tops up to FUND_AMOUNT only (mints the shortfall).
 *
 * Why the consumer holds AURA: `Stake.reward` does
 * `aura.safeTransferFrom(msg.sender, reward, amount)` where msg.sender is the
 * RewardConsumer — so the consumer is the AURA source. It force-approves each
 * vault inline in `_processReport`, so there is no per-vault approval step.
 */

async function main(): Promise<void> {
  const deployments = JSON.parse(readFileSync("deployments/deployments.json", "utf8"));
  const [deployer] = await ethers.getSigners();
  const relayerPk = process.env.ORACLE_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  const relayer = relayerPk ? new ethers.Wallet(relayerPk, ethers.provider) : deployer;

  const consumer = deployments.rewardConsumer;
  if (!consumer) throw new Error("deployments.json missing rewardConsumer");

  const aura = await ethers.getContractAt("AuraToken", deployments.auraToken);
  const amount = ethers.parseUnits(process.env.FUND_AMOUNT ?? "100000", 18);

  console.log(`\nAuraToken        ${deployments.auraToken}`);
  console.log(`RewardConsumer   ${consumer}`);
  console.log(`Signer           ${relayer.address}`);
  console.log(`Target balance   ${ethers.formatUnits(amount, 18)} AURA\n`);

  const before: bigint = await aura.balanceOf(consumer);
  console.log(`Balance before   ${ethers.formatUnits(before, 18)} AURA`);

  const shortfall = amount > before ? amount - before : 0n;
  if (shortfall === 0n) {
    console.log(`\nAlready funded — nothing to do.`);
    return;
  }

  const tx = await aura.connect(relayer).transfer(consumer, shortfall);
  const receipt = await tx.wait();
  console.log(`\nFunded ${ethers.formatUnits(shortfall, 18)} AURA\ntx ${receipt?.hash}`);

  const after: bigint = await aura.balanceOf(consumer);
  console.log(`Balance after    ${ethers.formatUnits(after, 18)} AURA`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
