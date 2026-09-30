/**
 * Sync deployments → the pieces that must know the addresses, so a redeploy is
 * one command instead of hand-editing YAML and .env files:
 *
 *   1. `indexer/config.yaml` — every chain contract's `address:` and the chain's
 *      `start_block`, taken from `deployments/deployments.json`. Dynamic
 *      contracts (Handle, Stake) carry no address and are left alone.
 *   2. prints the env lines to paste into `oracle/.env` and `app/.env`.
 *
 *   node scripts/sync-indexer.mjs [--write]     (default: dry run)
 */
import { readFileSync, writeFileSync } from "node:fs";

const WRITE = process.argv.includes("--write");
const deployments = JSON.parse(readFileSync("deployments/deployments.json", "utf8"));

/** config.yaml contract name → deployments.json key. Only the sources the
 *  indexer actually indexes (USDC / AuraToken / AddressesProvider / FeeCollector
 *  have no events worth indexing and no entry). */
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

const configPath = "../indexer/config.yaml";
const raw = readFileSync(configPath, "utf8");
/** CRLF-safe: work line by line instead of one fragile block regex. */
const EOL = raw.includes("\r\n") ? "\r\n" : "\n";
const lines = raw.split(/\r?\n/);
let changed = 0;

for (const [name, key] of Object.entries(SOURCES)) {
  const address = deployments[key];
  if (!address) {
    console.warn(`  ! ${name}: no ${key} in deployments.json — skipped`);
    continue;
  }
  const nameLine = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (nameLine === -1) {
    console.warn(`  ! ${name}: not found in config.yaml`);
    continue;
  }
  // Only touch the `address:` inside this contract's own block: scan forward
  // until the next `- name:` at the same indent level.
  let touched = 0;
  for (let i = nameLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {6}- name: /.test(line)) break; // next contract
    if (/^ {8}address: "0x/.test(line)) {
      lines[i] = line.replace(/0x[0-9a-fA-F]{40}/, address);
      touched += 1;
    }
  }
  if (touched === 1) {
    changed += 1;
    console.log(`  ✓ ${name.padEnd(16)} ${address}`);
  } else {
    console.log(`  · ${name.padEnd(16)} dynamic contract or already current`);
  }
}

// The chain starts at the earliest deployed contract, so no event is missed.
const startBlocks = Object.values(deployments.startBlocks ?? {}).filter((n) => Number.isInteger(n));
if (startBlocks.length) {
  const first = Math.min(...startBlocks);
  const startLine = lines.findIndex((l) => /^ {4}start_block: \d+/.test(l));
  if (startLine !== -1 && lines[startLine] !== `    start_block: ${first}`) {
    lines[startLine] = `    start_block: ${first}`;
    changed += 1;
    console.log(`  ✓ start_block      ${first}`);
  }
}

if (WRITE) {
  writeFileSync(configPath, lines.join(EOL) + EOL);
  console.log(`\nwrote ${configPath} (${changed} change(s))`);
} else {
  console.log(`\ndry run — ${changed} change(s). Re-run with --write`);
}

console.log(`
Env lines for a fresh deployment (chainId ${deployments.chainId}):

# oracle/.env
CHAIN_ID=${deployments.chainId}
MARKET_MAKER_ADDRESS=${deployments.marketMaker}
ORACLE_FACTORY_ADDRESS=${deployments.oracleFactory}
HANDLE_FACTORY_ADDRESS=${deployments.handleFactory}
INDEXER_URL=http://localhost:8080/v1/graphql

# app/.env
VITE_MARKET_MAKER_ADDRESS=${deployments.marketMaker}
VITE_ORDER_BOOK_ADDRESS=${deployments.orderBook}
VITE_HANDLE_FACTORY_ADDRESS=${deployments.handleFactory}
VITE_POOL_ADDRESS=${deployments.pool}
VITE_AURA_TOKEN_ADDRESS=${deployments.auraToken}
VITE_USDC_ADDRESS=${deployments.usdc}
VITE_REVENUE_SHARING_ADDRESS=${deployments.revenueSharing}
VITE_INDEXER_URL=http://localhost:8080/v1/graphql

# indexer/.env (never committed) — the token + the historical RPC fallback
ENVIO_API_TOKEN=<from https://envio.dev/app/api-tokens>
ENVIO_RPC_URL=<https://10143.rpc.hypersync.xyz/…>
`);
