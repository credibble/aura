import { ethers } from "hardhat";
import { readFileSync, existsSync } from "node:fs";

/** Take @ai out of trading — un-graduate it (it was seeded before the set was revised). */
async function main(): Promise<void> {
  const deps = existsSync("deployments/deployments.json")
    ? JSON.parse(readFileSync("deployments/deployments.json", "utf8"))
    : {};
  const hf = await ethers.getContractAt("HandleFactory", deps.handleFactory);
  const id = ethers.encodeBytes32String("ai");
  const addr = await hf.handleOf(id);
  if (addr === ethers.ZeroAddress) {
    console.log("@ai not created — nothing to do");
    return;
  }
  const h = await ethers.getContractAt("Handle", addr);
  const before = await h.graduated();
  if (!before) {
    console.log("@ai already un-graduated");
    return;
  }
  const [signer] = await ethers.getSigners();
  const tx = await h.connect(signer).setGraduated(false);
  await tx.wait();
  console.log(`@ai un-graduated (${addr}) — tx ${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});