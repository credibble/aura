#!/usr/bin/env node
/**
 * One-pass fresh deploy: contracts → verify → indexer config → sources.
 *
 *   cd smart-contracts
 *   PRIVATE_KEY=$RELAYER_PK ORACLE_PRIVATE_KEY=$RELAYER_PK node scripts/deploy-all.mjs [--skip-indexer]
 *
 * What it does, in order:
 *   1. hardhat deploy.ts          (writes deployments/deployments.json)
 *   2. hardhat verify-deploy.ts   (proves the factory signer == the relayer)
 *   3. node sync-indexer.mjs --write  (indexer/config.yaml addresses + start block)
 *   4. indexer `envio codegen`    (regenerates the handler types from config + schema)
 *   5. hardhat seed-handles.ts    (10 handles, each with its own scoped sources)
 *   6. hardhat deploy-consumers.ts (CRE Reward + Graduation consumer contracts)
 *   7. hardhat wire-graduators.ts  (GraduationConsumer → each handle's graduator)
 *
 * Then it prints the env lines to paste into oracle/.env and app/.env, and how to
 * start indexing.
 *
 * Coverage note: `envio dev` / `envio start` sync through HyperSync, which reads
 * the whole range in one request — the old hour-long, 100-block-limited reindex
 * through the public RPC is gone. The Envio CLI ships a linux/darwin native
 * addon, so on Windows run steps 4+ in WSL.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const STEP = (n, msg) => console.log(`\n=== ${n}. ${msg} ===`);
const run = (cmd, cwd = process.cwd()) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
};

const skipIndexer = process.argv.includes("--skip-indexer");
const repo = process.cwd().endsWith("smart-contracts") ? `${process.cwd()}/..` : process.cwd();
const sc = `${repo}/smart-contracts`;
const idx = `${repo}/indexer`;

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

STEP(3, "sync the indexer config (addresses + start block)");
run("node scripts/sync-indexer.mjs --write", sc);

if (skipIndexer) {
  console.log("\n(--skip-indexer: skipping codegen)");
} else if (process.platform === "win32") {
  STEP(4, "indexer codegen — skipped: the Envio CLI addon is linux/darwin only");
  console.log("Run this in WSL before starting the indexer:\n  cd indexer && npm run codegen");
} else {
  STEP(4, "indexer codegen (regenerates the handler types)");
  run("npm run codegen", idx);
}

STEP(5, "seed 10 handles, each with its own scoped sources");
run("npx hardhat run scripts/seed-handles.ts --network monadTestnet", sc);

STEP(6, "deploy the CRE consumer contracts (Reward + Graduation)");
run("npx hardhat run scripts/deploy-consumers.ts --network monadTestnet", sc);

STEP(7, "wire the GraduationConsumer as each handle's graduator");
run("npx hardhat run scripts/wire-graduators.ts --network monadTestnet", sc);

// Env lines for the two services, straight from the deployment record.
const d = JSON.parse(readFileSync(`${sc}/deployments/deployments.json`, "utf8"));
console.log(`
=== env for the services ===

# oracle/.env
CHAIN_ID=${d.chainId}
MARKET_MAKER_ADDRESS=${d.marketMaker}
ORACLE_FACTORY_ADDRESS=${d.oracleFactory}
HANDLE_FACTORY_ADDRESS=${d.handleFactory}
INDEXER_URL=http://localhost:8080/v1/graphql

# app/.env
VITE_MARKET_MAKER_ADDRESS=${d.marketMaker}
VITE_ORDER_BOOK_ADDRESS=${d.orderBook}
VITE_HANDLE_FACTORY_ADDRESS=${d.handleFactory}
VITE_POOL_ADDRESS=${d.pool}
VITE_AURA_TOKEN_ADDRESS=${d.auraToken}
VITE_USDC_ADDRESS=${d.usdc}
VITE_REVENUE_SHARING_ADDRESS=${d.revenueSharing}
VITE_INDEXER_URL=http://localhost:8080/v1/graphql

# indexer/.env (never committed) — the Envio token + the historical RPC fallback
ENVIO_API_TOKEN=<from https://envio.dev/app/api-tokens>
ENVIO_RPC_URL=<https://10143.rpc.hypersync.xyz/…>

# then:
#   cd indexer && npm run dev      (needs Docker; WSL on Windows)
#   cd oracle  && docker compose up -d --force-recreate oracle-api oracle-worker
#   restart the app dev server so it re-reads app/.env
`);
