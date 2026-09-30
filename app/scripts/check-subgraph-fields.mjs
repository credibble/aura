/**
 * Subgraph contract test — the app's queries are hand-written GraphQL, so a
 * schema change (a renamed field, a dropped entity, a missing derived list) only
 * shows up as a runtime error until this runs.
 *
 *   node scripts/check-subgraph-fields.mjs
 *
 * It reads the subgraph schema and asserts every entity + field the app actually
 * uses still exists. Add to CI next to check-writes/check-routes.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = "../../smart-contracts/subgraph/schema.graphql";
const APP_SRC = "src";

/** entity → fields the app selects (scalar, derived list, or nested). */
const REQUIRED = {
  Handle: [
    "id",
    "contract",
    "stake",
    "name",
    "symbol",
    "metadata",
    "sources",
    "aura",
    "auraDelta",
    "graduated",
    "verified",
    "category",
    "categoryId",
    "windowMinutes",
    "active",
    "windowCount",
    "auraHistory",
    "windows",
  ],
  AuraHistory: ["aura", "summary", "timestamp", "blockNumber"],
  Window: [
    "id",
    "handle",
    "oracle",
    "question",
    "style",
    "windowStart",
    "windowEnd",
    "outcomes",
    "initialProbabilities",
    "prices",
    "q",
    "liquidity",
    "reference",
    "settled",
    "winningOutcome",
    "volume",
  ],
  Trade: ["id", "user", "outcome", "kind", "premium", "proceeds", "shares", "price", "ts", "window"],
  Order: ["id", "maker", "outcome", "side", "price", "size", "filled", "status", "createdAt"],
  OrderFill: ["id", "order", "taker", "outcome", "shares", "price", "ts"],
  PricePoint: ["ts", "prices", "window"],
  Stats: [
    "id",
    "handleCount",
    "windowCount",
    "openWindows",
    "totalVolume",
    "totalCash",
  ],
  Stake: ["id", "contract", "handle", "totalSupply", "totalAssets", "valuePerToken", "snapshots"],
  StakeSnapshot: ["id", "stake", "timestamp", "totalSupply", "totalAssets", "valuePerToken"],
  PoolSnapshot: ["id", "pool", "timestamp", "idle", "totalReserved", "totalSupply", "totalAssets", "valuePerToken"],
  PoolEvent: ["id", "pool", "oracle", "kind", "amount", "to", "timestamp"],
};

const schemaPath = new URL(SCHEMA, import.meta.url);
const schema = readFileSync(schemaPath, "utf8");

/** Parse `type X @entity { field: … }` blocks into field sets. */
function entities(src) {
  // Doc comments AND line comments are removed first: `${…}` inside a trailing
  // comment would otherwise close the block early and hide every later field.
  const clean = src.replace(/"""[\s\S]*?"""/g, "").replace(/#.*$/gm, "");
  const map = new Map();
  const rx = /type\s+(\w+)[^{]*\{([^}]*)\}/g;
  for (const [, name, body] of clean.matchAll(rx)) {
    const fields = new Set(
      body
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.match(/^(\w+)\s*[:(]/)?.[1])
        .filter(Boolean),
    );
    map.set(name, fields);
  }
  return map;
}

/**
 * Cross-check: every `entity(` that appears in an app query should be a real
 * subgraph collection (pluralised entity, or a known custom root).
 */
function queryRoots() {
  const roots = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) {
        const src = readFileSync(p, "utf8");
        for (const [, name] of src.matchAll(/(?:^|[\s{])([a-zA-Z]+)\s*\(\s*(?:where|orderBy|first|skip|\$)/gm)) {
          if (name) roots.add(name);
        }
      }
    }
  };
  walk(APP_SRC);
  return roots;
}

const table = entities(schema);
let failures = 0;

console.log("Subgraph contract check\n");
for (const [entity, fields] of Object.entries(REQUIRED)) {
  const have = table.get(entity);
  if (!have) {
    failures += 1;
    console.log(`  ✗ ${entity.padEnd(14)} entity missing from the schema`);
    continue;
  }
  const missing = fields.filter((f) => !have.has(f));
  if (missing.length) {
    failures += 1;
    console.log(`  ✗ ${entity.padEnd(14)} missing fields: ${missing.join(", ")}`);
  } else {
    console.log(`  ✓ ${entity.padEnd(14)} ${fields.length} fields present`);
  }
}

// Pluralised collections the app queries (handles, windows, trades, …).
const collections = [...queryRoots()].filter((r) => !r.startsWith("$"));
const known = new Set(["handles", "windows", "trades", "orders", "orderFills", "pricePoints", "stats", "stakes", "stakeSnapshots", "poolSnapshots", "poolEvents"]);
const unknown = collections.filter((c) => !known.has(c));
if (unknown.length) {
  // Informational: these are usually SDK/other calls, not subgraph collections.
  console.log(`\n  · root fields seen in app queries: ${collections.join(", ")}`);
}
console.log(
  failures === 0
    ? `\nSchema satisfies every app query.\n`
    : `\n${failures} entity check(s) FAILED — the app queries fields the schema doesn't have.\n`,
);
process.exit(failures === 0 ? 0 : 1);
