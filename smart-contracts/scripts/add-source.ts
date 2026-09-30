import { ethers } from "hardhat";
import { readFileSync, existsSync } from "node:fs";

/**
 * Add the FOX Sports soccer source to the seeded @ronaldo handle.
 * `addSource` is onlyProtocol — the caller must be the HandleFactory owner or
 * the handle's auraUpdater (the oracle relayer).
 *
 *   PRIVATE_KEY=0x.. npx hardhat run scripts/add-source.ts --network monadTestnet
 *
 * Uses the deployed addresses from deployments/deployments.json (override with
 * HANDLE_FACTORY_ADDRESS / ORACLE_FACTORY_ADDRESS env).
 */
const FOX_SOURCE = JSON.stringify({
  platform: "foxsports",
  feed: "https://api.foxsports.com/v2/content/optimized-rss?partnerKey=MB0Wehpmuj2lUhuRhQaafhBjAJqaPU244mlTDK1i&size=30&tags=fs%2Fsoccer%2Csoccer%2Fepl%2Fleague%2F1%2Csoccer%2Fmls%2Fleague%2F5%2Csoccer%2Fucl%2Fleague%2F7%2Csoccer%2Feuropa%2Fleague%2F8%2Csoccer%2Fwc%2Fleague%2F12%2Csoccer%2Feuro%2Fleague%2F13%2Csoccer%2Fwwc%2Fleague%2F14%2Csoccer%2Fnwsl%2Fleague%2F20%2Csoccer%2Fcwc%2Fleague%2F26%2Csoccer%2Fgold_cup%2Fleague%2F32%2Csoccer%2Funl%2Fleague%2F67",
  label: "FOX Sports Soccer",
  topic: "ronaldo",
  context:
    "Analyse ronaldo: score the soccer news items for @ronaldo's aura. Rises when he scores, breaks records, wins, or is in the spotlight; falls on injuries, benching, or negative headlines.",
  tags: [],
});

async function main(): Promise<void> {
  const [signer] = await ethers.getSigners();
  const deployments = existsSync("deployments/deployments.json")
    ? (JSON.parse(readFileSync("deployments/deployments.json", "utf8")) as Record<string, string>)
    : {};
  const handleFactoryAddress =
    process.env.HANDLE_FACTORY_ADDRESS ?? deployments.handleFactory;
  if (!handleFactoryAddress) throw new Error("HANDLE_FACTORY_ADDRESS not set / not in deployments.json");

  const handleFactory = await ethers.getContractAt("HandleFactory", handleFactoryAddress);
  const ronaldo = ethers.encodeBytes32String("ronaldo");
  const handle = await ethers.getContractAt("Handle", await handleFactory.handleOf(ronaldo));

  console.log(`@ronaldo handle: ${await handle.getAddress()}`);
  console.log(`sources before: ${await handle.sourcesCount()}`);
  for (let i = 0n; i < await handle.sourcesCount(); i++) {
    console.log(`  [${i}] ${await handle.sources(i)}`);
  }

  const tx = await handle.connect(signer).addSource(FOX_SOURCE);
  await tx.wait();
  console.log(`\nAdded foxsports source → @ronaldo (tx ${tx.hash})`);
  console.log(`sources after: ${await handle.sourcesCount()}`);
  console.log(`  [${(await handle.sourcesCount()) - 1n}] ${await handle.sources((await handle.sourcesCount()) - 1n)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});