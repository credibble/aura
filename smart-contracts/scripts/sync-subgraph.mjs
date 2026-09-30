/**
 * Sync deployments → the pieces that must know the addresses, so a redeploy is
 * one command instead of hand-editing YAML and .env files:
 *
 *   1. `subgraph/subgraph.yaml` — every data source's `address:` + `startBlock:`
 *      (taken from `deployments/deployments.json`).
 *   2. `subgraph/docker-compose.yml` — graph-node's `ethereum:` network mapping.
 *   3. prints the env lines to paste into `oracle/.env` and `app/.env`.
 *
 *   node scripts/sync-subgraph.mjs [--write]     (default: dry run)
 */
import { readFileSync, writeFileSync } from "node:fs";

const WRITE = process.argv.includes("--write");
const deployments = JSON.parse(readFileSync("deployments/deployments.json", "utf8"));

/** subgraph.yaml data-source name → deployments.json key.
 *  Only the sources the subgraph actually indexes (USDC / AuraToken /
 *  AddressesProvider / FeeCollector have no data source and don't need one). */
const SOURCES = {
  Configurator: "configurator",
  MarketRegistry: "marketRegistry",
  OracleFactory: "oracleFactory",
  HandleFactory: "handleFactory",
  Pool: "pool",
  RevenueSharing: "revenueSharing",
  MarketMaker: "marketMaker",
  OrderBook: "orderBook",
};

const yamlPath = "subgraph/subgraph.yaml";
const raw = readFileSync(yamlPath, "utf8");
/** CRLF-safe: work line by line instead of one fragile block regex. */
const EOL = raw.includes("\r\n") ? "\r\n" : "\n";
const lines = raw.split(/\r?\n/);
let changed = 0;

for (const [name, key] of Object.entries(SOURCES)) {
  const address = deployments[key];
  const block = deployments.startBlocks?.[key];
  if (!address || !block) {
    console.warn(`  ! ${name}: no ${key} in deployments.json — skipped`);
    continue;
  }
  const nameLine = lines.findIndex((l) => l.trim() === `name: ${name}`);
  if (nameLine === -1) {
    console.warn(`  ! ${name}: not found in subgraph.yaml`);
    continue;
  }
  // Only touch the `address:`/`startBlock:` inside this source's own block: scan
  // forward until the next `name:` at the same indent level.
  let touched = 0;
  for (let i = nameLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {4}name: /.test(line)) break; // next data source
    if (/^ {6}address: "0x/.test(line)) {
      lines[i] = line.replace(/0x[0-9a-fA-F]{40}/, address);
      touched += 1;
      continue;
    }
    if (/^ {6}startBlock: \d+/.test(line)) {
      lines[i] = line.replace(/\d+/, String(block));
      touched += 1;
    }
  }
  if (touched === 2) {
    changed += 1;
    console.log(`  ✓ ${name.padEnd(16)} ${address} @ ${block}`);
  } else {
    // The source may be a template (no address/startBlock) — that's legitimate.
    console.log(`  · ${name.padEnd(16)} template or already current (${touched} field${touched === 1 ? "" : "s"})`);
  }
}
const yaml = lines.join(EOL) + EOL;

// graph-node must index the same chain the contracts live on.
const composePath = "subgraph/docker-compose.yml";
let compose = readFileSync(composePath, "utf8");
const rpc = process.env.RPC_URL ?? "https://testnet-rpc.monad.xyz";
const network = process.env.SUBGRAPH_NETWORK ?? "monad-testnet";
const ethereum = `${network}:${rpc}`;
const composeBefore = compose;
compose = compose.replace(/(\n      ethereum: ")[^"]+(")/, `$1${ethereum}$2`);
if (compose !== composeBefore) console.log(`  ✓ graph-node ethereum → ${ethereum}`);

if (WRITE) {
  writeFileSync(yamlPath, yaml);
  writeFileSync(composePath, compose);
  console.log(`\nwrote ${yamlPath} (${changed} source(s)) + ${composePath}`);
} else {
  console.log(`\ndry run — ${changed} source(s) would change. Re-run with --write`);
}

console.log(`
Env lines for a fresh deployment (chainId ${deployments.chainId}):

# oracle/.env
CHAIN_ID=${deployments.chainId}
MARKET_MAKER_ADDRESS=${deployments.marketMaker}
ORACLE_FACTORY_ADDRESS=${deployments.oracleFactory}
HANDLE_FACTORY_ADDRESS=${deployments.handleFactory}
SUBGRAPH_URL=http://localhost:8000/subgraphs/name/aura/aura

# app/.env
VITE_MARKET_MAKER_ADDRESS=${deployments.marketMaker}
VITE_ORDER_BOOK_ADDRESS=${deployments.orderBook}
VITE_HANDLE_FACTORY_ADDRESS=${deployments.handleFactory}
VITE_POOL_ADDRESS=${deployments.pool}
VITE_AURA_TOKEN_ADDRESS=${deployments.auraToken}
VITE_USDC_ADDRESS=${deployments.usdc}
VITE_REVENUE_SHARING_ADDRESS=${deployments.revenueSharing}
VITE_SUBGRAPH_URL=http://localhost:8000/subgraphs/name/aura/aura
`);
