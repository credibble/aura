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
    const count = Number(await h.categoriesCount());
    const cats: string[] = [];
    for (let i = 0; i < count; i++) cats.push((await h.categories(i)).toString());
    console.log(
      `@${id} ${addr} graduated=${await h.graduated()} sources=${(await h.sourcesCount()).toString()} categories=[${cats.join(", ")}]`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});