import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  const fee = await ethers.provider.getFeeData();
  const block = await ethers.provider.getBlockNumber();
  console.log(`block        ${block}`);
  console.log(`deployer     ${deployer.address}`);
  console.log(`balance      ${ethers.formatEther(bal)} MON`);
  console.log(`gasPrice     ${fee.gasPrice ? ethers.formatUnits(fee.gasPrice, "gwei") : "?"} gwei`);
  console.log(`maxFeePerGas ${fee.maxFeePerGas ? ethers.formatUnits(fee.maxFeePerGas, "gwei") : "?"} gwei`);
}

main().catch((e) => { console.error(e); process.exit(1); });
