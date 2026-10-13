import { ethers } from "hardhat";
import { readFileSync } from "node:fs";

/**
 * Wire the CRE GraduationConsumer as the dedicated `graduator` on every handle
 * from deployments.json, so the graduation workflow can call
 * `Handle.setGraduated(true)` without taking the oracle relayer's curation
 * rights. Also wire the RewardConsumer's vaults nothing to do here — the
 * RewardConsumer approves each Stake inline.
 *
 *   PRIVATE_KEY=$HANDLE_OWNER_PK npx hardhat run scripts/wire-graduators.ts --network monadTestnet
 *
 * Env (optional):
 *   GRADUATOR  override the graduator address (default: deployments.graduationConsumer)
 *
 * Requires this revision's `Handle.setGraduator` (a fresh root deploy) and the
 * signer to be the HandleFactory owner.
 */

async function main(): Promise<void> {
  const deployments = JSON.parse(readFileSync("deployments/deployments.json", "utf8"));
  const [signer] = await ethers.getSigners();
  const graduator: string | undefined =
    process.env.GRADUATOR ?? deployments.graduationConsumer;
  if (!graduator) {
    throw new Error(
      "no graduator: set GRADUATOR or run deploy-consumers.ts first (writes graduationConsumer)",
    );
  }

  const factory = await ethers.getContractAt("HandleFactory", deployments.handleFactory);
  console.log(`\nHandleFactory ${deployments.handleFactory}`);
  console.log(`Signer        ${signer.address}`);
  console.log(`Graduator     ${graduator}\n`);

  const handles: Record<string, { id: string }> = deployments.handles ?? {};
  const slugs = Object.keys(handles);
  if (slugs.length === 0) {
    console.log("No handles in deployments.json — nothing to wire.");
    return;
  }

  let wired = 0;
  for (const slug of slugs) {
    const id = handles[slug].id;
    const addr = await factory.handleOf(id);
    const handle = await ethers.getContractAt("Handle", addr);
    const current: string = await handle.graduator();
    if (current.toLowerCase() === graduator.toLowerCase()) {
      console.log(`  @${slug}: already wired`);
      continue;
    }
    const tx = await factory.setGraduator(id, graduator);
    await tx.wait();
    wired++;
    console.log(`  @${slug}: graduator → ${graduator}`);
  }

  console.log(`\nWired ${wired} handle(s); ${slugs.length} total.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
