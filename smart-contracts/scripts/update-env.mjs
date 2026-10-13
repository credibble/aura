#!/usr/bin/env node
/**
 * Upsert the deployed contract addresses into the service env files from
 * deployments/deployments.json — WITHOUT printing or exposing any secret.
 *
 *   cd smart-contracts
 *   node scripts/update-env.mjs app oracle
 *
 * Only the listed address keys are touched; every other line (keys, DB URLs,
 * tokens) is left byte-for-byte intact. This script never reads a value back
 * into the agent/logs — it prints key NAMES only. `.env` files are gitignored.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const d = JSON.parse(readFileSync("deployments/deployments.json", "utf8"));

const TARGETS = {
  app: {
    file: "../app/.env",
    indexerKey: "VITE_INDEXER_URL",
    keys: {
      VITE_MARKET_MAKER_ADDRESS: d.marketMaker,
      VITE_ORDER_BOOK_ADDRESS: d.orderBook,
      VITE_HANDLE_FACTORY_ADDRESS: d.handleFactory,
      VITE_POOL_ADDRESS: d.pool,
      VITE_AURA_TOKEN_ADDRESS: d.auraToken,
      VITE_USDC_ADDRESS: d.usdc,
      VITE_REVENUE_SHARING_ADDRESS: d.revenueSharing,
    },
  },
  oracle: {
    file: "../oracle/.env",
    indexerKey: "INDEXER_URL",
    keys: {
      CHAIN_ID: String(d.chainId),
      MARKET_MAKER_ADDRESS: d.marketMaker,
      ORACLE_FACTORY_ADDRESS: d.oracleFactory,
      HANDLE_FACTORY_ADDRESS: d.handleFactory,
      ORACLE_ADDRESS: d.relayer,
    },
  },
};

function upsert(content, key, value) {
  const lines = content.split(/\r?\n/);
  const re = new RegExp(`^\\s*${key}=`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      lines[i] = `${key}=${value}`;
      return lines.join("\n");
    }
  }
  lines.push(`${key}=${value}`);
  return lines.join("\n");
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("usage: node scripts/update-env.mjs app|oracle [...]");
  process.exit(1);
}

for (const name of targets) {
  const t = TARGETS[name];
  if (!t) {
    console.error(`unknown target: ${name}`);
    process.exit(1);
  }
  const path = resolve(t.file);
  if (!existsSync(path)) {
    console.log(`${name}: ${t.file} not found — skipped`);
    continue;
  }
  let content = readFileSync(path, "utf8");
  const updated = [];
  for (const [key, value] of Object.entries(t.keys)) {
    if (!value || value === "undefined") {
      console.log(`${name}: ${key} has no value in deployments.json — skipped`);
      continue;
    }
    content = upsert(content, key, value);
    updated.push(key);
  }
  // Optional: point the service at a specific indexer (e.g. the deployed
  // HyperIndex endpoint) via the INDEXER_URL env var.
  if (process.env.INDEXER_URL && t.indexerKey) {
    content = upsert(content, t.indexerKey, process.env.INDEXER_URL);
    updated.push(t.indexerKey);
  }
  if (!content.endsWith("\n")) content += "\n";
  writeFileSync(path, content);
  console.log(`${name}: updated ${updated.length} key(s): ${updated.join(", ")}`);
}
