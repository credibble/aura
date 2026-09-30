#!/usr/bin/env node
/**
 * One-pass fresh deploy: contracts → verify → manifest sync → subgraph → sources.
 *
 *   cd smart-contracts
 *   PRIVATE_KEY=$RELAYER_PK ORACLE_PRIVATE_KEY=$RELAYER_PK node scripts/deploy-all.mjs [--skip-subgraph]
 *
 * What it does, in order:
 *   1. hardhat deploy.ts          (writes deployments/deployments.json)
 *   2. hardhat verify-deploy.ts   (proves the factory signer == the relayer)
 *   3. node sync-subgraph.mjs --write (manifest + start blocks + graph-node RPC)
 *   4. graph codegen && graph build && graph deploy   (reindex; SLOW)
 *   5. hardhat seed-handles.ts    (10 handles, each with its own scoped sources)
 *
 * Then it prints the env lines to paste into oracle/.env and app/.env.
 *
 * Coverage note: the public Monad RPC caps `eth_getLogs` at 100 blocks, so the
 * reindex in step 4 takes roughly an hour. A private RPC is the only lever.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const STEP = (n, msg) => console.log(`\n=== ${n}. ${msg} ===`);
const run = (cmd, cwd = process.cwd()) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
};

const skipSubgraph = process.argv.includes("--skip-subgraph");
const repo = process.cwd().endsWith("smart-contracts") ? `${process.cwd()}/..` : process.cwd();
const sc = `${repo}/smart-contracts`;
const sg = `${sc}/subgraph`;

const pk = process.env.ORACLE_PRIVATE_KEY;
if (!process.env.PRIVATE_KEY || !pk) {
  console.error(
    "Set PRIVATE_KEY (deployer, funded) and ORACLE_PRIVATE_KEY (relayer = factory signer).",
  );
  process.exit(1);
}
if (!existsSync(`${sc}/deployments/deployments.json`)) {
  console.log("(no previous deployments.json — this is a first deploy)");
}

STEP(1, "deploy contracts");
run("npx hardhat run scripts/deploy.ts --network monadTestnet", sc);

STEP(2, "verify wiring (factory signer == relayer)");
run("npx hardhat run scripts/verify-deploy.ts --network monadTestnet", sc);

STEP(3, "sync the subgraph manifest + start blocks + graph-node RPC");
run("node scripts/sync-subgraph.mjs --write", sc);

if (skipSubgraph) {
  console.log("\n(--skip-subgraph: skipping compile + reindex)");
} else {
  STEP(4, "compile + deploy the subgraph (reindexes from the start blocks — this is the slow step)");
  run("npx graph codegen", sg);
  run("npx graph build", sg);
  run(
    `npx graph deploy aura/aura --node http://localhost:8020 --ipfs http://localhost:5001 --version-label v0.2.0`,
    sg,
  );
}

STEP(5, "seed 10 handles, each with its own scoped sources");
run("npx hardhat run scripts/seed-handles.ts --network monadTestnet", sc);

// Env lines for the two services, straight from the deployment record.
const d = JSON.parse(readFileSync(`${sc}/deployments/deployments.json`, "utf8"));
console.log(`
=== env for the services ===

# oracle/.env
CHAIN_ID=${d.chainId}
MARKET_MAKER_ADDRESS=${d.marketMaker}
ORACLE_FACTORY_ADDRESS=${d.oracleFactory}
HANDLE_FACTORY_ADDRESS=${d.handleFactory}
SUBGRAPH_URL=http://localhost:8000/subgraphs/name/aura/aura

# app/.env
VITE_MARKET_MAKER_ADDRESS=${d.marketMaker}
VITE_ORDER_BOOK_ADDRESS=${d.orderBook}
VITE_HANDLE_FACTORY_ADDRESS=${d.handleFactory}
VITE_POOL_ADDRESS=${d.pool}
VITE_AURA_TOKEN_ADDRESS=${d.auraToken}
VITE_USDC_ADDRESS=${d.usdc}
VITE_REVENUE_SHARING_ADDRESS=${d.revenueSharing}
VITE_SUBGRAPH_URL=http://localhost:8000/subgraphs/name/aura/aura

# then:
#   cd oracle && docker compose up -d --force-recreate oracle-api oracle-worker
#   (restart the app dev server so it re-reads app/.env)
`);
