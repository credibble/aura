import { ethers } from "hardhat";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Deploys the CRE consumer contracts (RewardConsumer + GraduationConsumer)
 * and updates deployments.json + CRE config.json files.
 *
 *   PRIVATE_KEY=0x.. npx hardhat run scripts/deploy-consumers.ts --network monadTestnet
 *
 * Requires the protocol to already be deployed (deployments.json must exist).
 *
 * Forwarder: the consumer's `onReport` only accepts calls from the Chainlink
 * KeystoneForwarder. The address is environment-specific:
 *   - production (monad-testnet): 0xF8344CFd5c43616a4366C34E3EEE75af79a74482
 *   - mock/simulation (monad-testnet): 0xB9F79d863261869B234c481D1f9A7af84AeAd192
 * Override with CRE_FORWARDER for another environment. Source:
 * https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
 */

const FORWARDER_BY_TARGET: Record<string, string> = {
  // Verified from the official CRE forwarder directory (monad-testnet).
  production: "0xF8344CFd5c43616a4366C34E3EEE75af79a74482",
  simulation: "0xB9F79d863261869B234c481D1f9A7af84AeAd192",
};

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  console.log(`\nDeployer: ${deployer.address}\n`);

  const env = process.env.CRE_ENV ?? "production";
  const forwarder = process.env.CRE_FORWARDER ?? FORWARDER_BY_TARGET[env];
  if (!forwarder) {
    throw new Error(`unknown CRE_ENV ${env} and no CRE_FORWARDER set`);
  }
  console.log(`CRE env    ${env}`);
  console.log(`Forwarder  ${forwarder}\n`);

  // Load existing deployments
  const deploymentsPath = "deployments/deployments.json";
  const deployments = JSON.parse(readFileSync(deploymentsPath, "utf-8"));

  const auraTokenAddress = deployments.auraToken;
  if (!auraTokenAddress) throw new Error("deployments.json missing auraToken");
  console.log(`AURA token: ${auraTokenAddress}`);

  // --- deploy RewardConsumer ----------------------------------------------

  const rewardConsumer = await (
    await ethers.getContractFactory("RewardConsumer")
  ).deploy(forwarder, auraTokenAddress);
  await rewardConsumer.waitForDeployment();
  const rewardConsumerAddr = await rewardConsumer.getAddress();
  console.log(`RewardConsumer deployed: ${rewardConsumerAddr}`);

  // --- deploy GraduationConsumer ------------------------------------------

  const graduationConsumer = await (
    await ethers.getContractFactory("GraduationConsumer")
  ).deploy(forwarder);
  await graduationConsumer.waitForDeployment();
  const graduationConsumerAddr = await graduationConsumer.getAddress();
  console.log(`GraduationConsumer deployed: ${graduationConsumerAddr}`);

  // --- verify wiring (ERC165 + forwarder) ---------------------------------

  const IERC165_ID = "0x01ffc9a7";
  const IRECEIVER_ID = ethers.id("onReport(bytes,bytes)").slice(0, 10);
  for (const [name, c] of [
    ["RewardConsumer", rewardConsumer],
    ["GraduationConsumer", graduationConsumer],
  ] as const) {
    const fwd = await (c as any).getForwarderAddress();
    const ok165 = await (c as any).supportsInterface(IERC165_ID);
    const okRecv = await (c as any).supportsInterface(IRECEIVER_ID);
    console.log(
      `${name}: forwarder=${fwd} IERC165=${ok165} IReceiver=${okRecv}`,
    );
    if (fwd.toLowerCase() !== forwarder.toLowerCase()) {
      throw new Error(`${name}: forwarder mismatch`);
    }
    if (!ok165 || !okRecv) {
      throw new Error(`${name}: ERC165 interface check failed`);
    }
  }

  // --- update deployments.json -------------------------------------------

  deployments.rewardConsumer = rewardConsumerAddr;
  deployments.graduationConsumer = graduationConsumerAddr;
  deployments.creForwarder = forwarder;

  writeFileSync(
    deploymentsPath,
    JSON.stringify(deployments, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  );
  console.log(`\nUpdated ${deploymentsPath}`);

  // --- update CRE config.json files ---------------------------------------

  const rewardConfigPath = "../cre/reward/config.json";
  const rewardConfig = JSON.parse(readFileSync(rewardConfigPath, "utf-8"));
  rewardConfig.consumerAddress = rewardConsumerAddr;
  writeFileSync(rewardConfigPath, JSON.stringify(rewardConfig, null, 2));
  console.log(`Updated ${rewardConfigPath}`);

  const graduationConfigPath = "../cre/graduation/config.json";
  const graduationConfig = JSON.parse(readFileSync(graduationConfigPath, "utf-8"));
  graduationConfig.consumerAddress = graduationConsumerAddr;
  writeFileSync(graduationConfigPath, JSON.stringify(graduationConfig, null, 2));
  console.log(`Updated ${graduationConfigPath}`);

  console.log("\nDone. Next steps:");
  console.log("  1. Fund RewardConsumer with AURA (treasury transfer)");
  console.log("  2. Grant GraduationConsumer as curator/auraUpdater on each Handle");
  console.log("     (HandleFactory.setCurator per handle — owner only)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
