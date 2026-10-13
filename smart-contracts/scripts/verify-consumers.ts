import { ethers } from "hardhat";
import { readFileSync } from "node:fs";

/**
 * Read-back verification of a fresh deploy: the CRE consumers are wired to the
 * production forwarder, the RewardConsumer is funded, and every handle has the
 * GraduationConsumer as its graduator. No writes.
 *
 *   npx hardhat run scripts/verify-consumers.ts --network monadTestnet
 */

const KEYSTONE_MONAD_TESTNET = "0xF8344CFd5c43616a4366C34E3EEE75af79a74482";

async function main(): Promise<void> {
  const d = JSON.parse(readFileSync("deployments/deployments.json", "utf8"));
  const aura = await ethers.getContractAt("AuraToken", d.auraToken);
  const reward = await ethers.getContractAt("RewardConsumer", d.rewardConsumer);
  const grad = await ethers.getContractAt("GraduationConsumer", d.graduationConsumer);
  const factory = await ethers.getContractAt("HandleFactory", d.handleFactory);

  let failures = 0;
  const check = (ok: boolean, label: string, got: unknown, want?: unknown) => {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${want === undefined ? "" : `  got=${got} want=${want}`}`);
    if (!ok) failures++;
  };

  console.log(`\nchain ${d.chainId}  deployer ${d.deployer}\n`);
  console.log("consumers");
  check(
    (await reward.getForwarderAddress()).toLowerCase() === KEYSTONE_MONAD_TESTNET.toLowerCase(),
    "RewardConsumer.forwarder",
    await reward.getForwarderAddress(),
    KEYSTONE_MONAD_TESTNET,
  );
  check(
    (await grad.getForwarderAddress()).toLowerCase() === KEYSTONE_MONAD_TESTNET.toLowerCase(),
    "GraduationConsumer.forwarder",
    await grad.getForwarderAddress(),
    KEYSTONE_MONAD_TESTNET,
  );
  check(
    (await reward.aura()).toLowerCase() === d.auraToken.toLowerCase(),
    "RewardConsumer.aura == AuraToken",
    await reward.aura(),
    d.auraToken,
  );
  const funded: bigint = await aura.balanceOf(d.rewardConsumer);
  check(funded > 0n, `RewardConsumer AURA balance`, ethers.formatEther(funded));

  console.log("\nhandles (graduator)");
  const handles: Record<string, { id: string; contract: string }> = d.handles ?? {};
  for (const slug of Object.keys(handles)) {
    const h = await ethers.getContractAt("Handle", handles[slug].contract);
    const g: string = await h.graduator();
    check(
      g.toLowerCase() === d.graduationConsumer.toLowerCase(),
      `@${slug}`,
      g,
      d.graduationConsumer,
    );
  }

  console.log(
    `\n${failures === 0 ? "ALL CHECKS PASS" : `${failures} CHECK(S) FAILED`} — ${Object.keys(handles).length} handles, factory ${await factory.getAddress()}\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
