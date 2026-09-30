import { ethers } from "hardhat";
import { readFileSync, existsSync } from "node:fs";

async function main(): Promise<void> {
  const deps = existsSync("deployments/deployments.json")
    ? JSON.parse(readFileSync("deployments/deployments.json", "utf8"))
    : {};
  const pool = await ethers.getContractAt("Pool", deps.pool);
  const usdc = await ethers.getContractAt("MockUSDC", deps.usdc);
  const [signer] = await ethers.getSigners();

  console.log("pool idle:", (await pool.idle()).toString());
  console.log("pool USDC balance:", (await usdc.balanceOf(deps.pool)).toString());
  console.log("signer USDC:", (await usdc.balanceOf(signer.address)).toString());
  console.log("signer pool allowance:", (await usdc.allowance(signer.address, deps.pool)).toString());

  const amount = 100_000n * 10n ** 18n;
  await (await usdc.approve(deps.pool, amount)).wait();
  await (await pool.deposit(amount)).wait();
  console.log("deposited 100k — new idle:", (await pool.idle()).toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});