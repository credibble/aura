import { ethers } from "hardhat";
import { readFileSync, existsSync } from "node:fs";

async function main(): Promise<void> {
  const deps = existsSync("deployments/deployments.json")
    ? JSON.parse(readFileSync("deployments/deployments.json", "utf8"))
    : {};
  const hf = await ethers.getContractAt("HandleFactory", deps.handleFactory);
  const reg = await ethers.getContractAt("MarketRegistry", deps.marketRegistry);
  console.log("handleCount:", (await hf.handleCount()).toString(), "registered:", (await reg.handleCount()).toString());
  for (const id of ["elon", "iphone", "tesla", "apple", "btc", "eth", "ai", "openai", "doge", "drake", "sabrina", "taylorswift", "messi", "gta6", "playstation"]) {
    const b = ethers.encodeBytes32String(id);
    const addr = await hf.handleOf(b);
    if (addr === ethers.ZeroAddress) {
      console.log(`@${id} NOT CREATED`);
      continue;
    }
    const h = await ethers.getContractAt("Handle", addr);
    console.log(
      `@${id} ${addr} graduated=${await h.graduated()} sources=${(await h.sourcesCount()).toString()} category=${(await h.category()).toString()}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});