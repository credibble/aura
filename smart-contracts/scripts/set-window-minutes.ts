import { ethers } from "hardhat";
import { readFileSync } from "node:fs";
import type { Contract } from "ethers";

/**
 * Point every deployed handle's window length at TARGET_MINUTES.
 *
 *   PRIVATE_KEY=$PK ORACLE_PRIVATE_KEY=$PK npx hardhat run scripts/set-window-minutes.ts --network monadTestnet
 *
 * Target length comes from TARGET_MINUTES (default 240 = 4h), so re-running for a
 * different horizon needs no edit. A window must be longer than the real aura
 * cadence or it opens and closes with no observation and is voided.
 *
 * `Handle.setWindowMinutes` is `onlyCurator`; the relayer (ORACLE_PRIVATE_KEY)
 * is the auraUpdater, which stands in for the curator until one is set — the
 * same key seed-handles.ts uses, so it alone may curate. Addresses come from
 * deployments/deployments.json, and a handle already at the target is skipped,
 * so re-running is safe.
 */
const TARGET_MINUTES = Number(process.env.TARGET_MINUTES ?? 240);

async function main(): Promise<void> {
  const deployments = JSON.parse(readFileSync("deployments/deployments.json", "utf8"));
  const [deployer] = await ethers.getSigners();
  const relayerPk = process.env.ORACLE_PRIVATE_KEY;
  const relayer = relayerPk ? new ethers.Wallet(relayerPk, ethers.provider) : deployer;

  console.log(`\nRelayer ${relayer.address}  →  target window ${TARGET_MINUTES} min\n`);

  const handles = (deployments.handles ?? {}) as Record<string, { contract: string }>;
  const labels = Object.keys(handles);
  if (labels.length === 0) {
    console.log("No handles in deployments/deployments.json — run seed-handles.ts first.");
    return;
  }

  let changed = 0;
  for (const label of labels) {
    const handle: Contract = await ethers.getContractAt("Handle", handles[label]!.contract);
    const before: bigint = await handle.windowMinutes();
    if (before === BigInt(TARGET_MINUTES)) {
      console.log(`· @${label.padEnd(9)} already ${TARGET_MINUTES} min`);
      continue;
    }
    const tx = await handle.connect(relayer).setWindowMinutes(TARGET_MINUTES);
    const receipt = await tx.wait();
    changed += 1;
    console.log(`✓ @${label.padEnd(9)} ${before} → ${TARGET_MINUTES} min  tx ${receipt?.hash}`);
  }
  console.log(`\nUpdated ${changed}/${labels.length} handle window(s) to ${TARGET_MINUTES} min.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
