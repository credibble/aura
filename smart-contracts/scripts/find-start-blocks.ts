import { readFileSync } from "node:fs";
import { createPublicClient, http, type Address } from "viem";
import { monadTestnet } from "viem/chains";

/**
 * Find each deployed contract's creation block by binary-searching
 * `eth_getCode` (code exists at the deploy block, empty before it). Writes
 * `deployments/start-blocks.json` so subgraph.yaml dataSources can pin
 * `startBlock` to the deployment blocks instead of 0.
 *
 *   npx tsx scripts/find-start-blocks.ts
 */
const rpc = process.env.RPC_URL ?? "https://testnet-rpc.monad.xyz";

interface Deployments {
  [key: string]: unknown;
  handleFactory?: string;
  marketRegistry?: string;
  pool?: string;
  oracleFactory?: string;
  marketMaker?: string;
  orderBook?: string;
}

/** Search window: the RPC prunes old state, so bound to the recent head. */
const WINDOW_BLOCKS = 50_000n;

async function creationBlock(client: ReturnType<typeof createPublicClient>, address: Address): Promise<number> {
  const hi = await client.getBlockNumber();
  const lo = hi - WINDOW_BLOCKS;
  if ((await client.getCode({ address, blockNumber: hi })) === "0x") {
    throw new Error(`${address}: no code at head — is it deployed?`);
  }
  if ((await client.getCode({ address, blockNumber: lo })) !== "0x") {
    return Number(lo); // deployed before the window — approximate
  }
  // Binary search: first block in [lo, hi] with non-empty code.
  let a = lo;
  let b = hi;
  while (a < b) {
    const mid = (a + b) >> 1n;
    const code = await client.getCode({ address, blockNumber: mid });
    if (code === "0x") a = mid + 1n;
    else b = mid;
  }
  return Number(a);
}

async function main(): Promise<void> {
  const deployments = JSON.parse(readFileSync("deployments/deployments.json", "utf8")) as Deployments;
  const client = createPublicClient({ chain: monadTestnet, transport: http(rpc) });

  const order: [string, string][] = [
    ["usdc", deployments.usdc!],
    ["auraToken", deployments.auraToken!],
    ["configurator", deployments.configurator!],
    ["feeCollector", deployments.feeCollector!],
    ["handleFactory", deployments.handleFactory!],
    ["marketRegistry", deployments.marketRegistry!],
    ["pool", deployments.pool!],
    ["oracleFactory", deployments.oracleFactory!],
    ["marketMaker", deployments.marketMaker!],
    ["revenueSharing", deployments.revenueSharing!],
    ["orderBook", deployments.orderBook!],
  ];

  const blocks: Record<string, number> = {};
  for (const [name, address] of order) {
    if (!address) continue;
    blocks[name] = await creationBlock(client, address as Address);
    console.log(`${name}: ${blocks[name]}`);
  }

  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("deployments", { recursive: true });
  writeFileSync("deployments/start-blocks.json", JSON.stringify(blocks, null, 2));
  console.log("\nWrote deployments/start-blocks.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});