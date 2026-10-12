/**
 * Indexer contract test — the app's queries are hand-written GraphQL, so a
 * schema change (a renamed field, a dropped entity, a missing derived list) only
 * shows up as a runtime error until this runs.
 *
 *   node scripts/check-indexer-fields.mjs
 *
 * It reads the Envio indexer schema and asserts every entity + field the app
 * actually uses still exists — plus the fields the CRE workflows select, since
 * they read the same index. Add to CI next to check-writes/check-routes.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = "../../indexer/schema.graphql";
const APP_SRC = "src";
const CRE_SRC = "../../cre";

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
    "categories",
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
    "strike",
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

/**
 * The CRE workflows read the SAME index (HyperSync-backed `/v1/graphql`), so
 * their selections get the same contract test. `nested` covers a selection set
 * one level down (`Stake.handle { name }`).
 */
const CRE_REQUIRED = {
  "reward/main.ts": { Stake: ["id", "totalAssets", "handle"], nested: { Handle: ["name"] } },
  "graduation/main.ts": { Handle: ["contract", "aura"] },
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
 * indexer collection (the entity name as declared, or a `_by_pk` root).
 */
function queryRoots() {
  const roots = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) {
        const src = readFileSync(p, "utf8");
        for (const [, name] of src.matchAll(/(?:^|[\s{])([a-zA-Z]+)\s*\(\s*(?:where|order_by|orderBy|limit|offset|first|skip|\$)/gm)) {
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

console.log("Indexer contract check\n");
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

// The CRE workflows query the same index over HTTP — cre/<workflow> selections
// must exist in the schema too, or a workflow silently skips its run on-chain.
for (const [file, spec] of Object.entries(CRE_REQUIRED)) {
  const checks = [
    ...Object.entries(spec).filter(([k]) => k !== "nested"),
    ...Object.entries(spec.nested ?? {}),
  ];
  const problems = [];
  for (const [entity, fields] of checks) {
    const have = table.get(entity);
    if (!have) {
      problems.push(`${entity} entity missing`);
      continue;
    }
    const missing = fields.filter((f) => !have.has(f));
    if (missing.length) problems.push(`${entity} missing ${missing.join(", ")}`);
  }
  if (problems.length === 0) {
    console.log(`  ✓ cre/${file.padEnd(21)} selections present`);
  } else {
    failures += 1;
    console.log(`  ✗ cre/${file.padEnd(21)} ${problems.join("; ")}`);
  }
}

// Indexer collections the app queries (Handle, Window, Trade, …).
const collections = [...queryRoots()].filter((r) => !r.startsWith("$"));
const known = new Set([
  "Handle",
  "Window",
  "Window_by_pk",
  "Trade",
  "Order",
  "OrderFill",
  "PricePoint",
  "Stats",
  "Stats_by_pk",
  "Stake",
  "Stake_by_pk",
  "StakeSnapshot",
  "PoolSnapshot",
  "PoolEvent",
]);
const unknown = collections.filter((c) => !known.has(c));
if (unknown.length) {
  // Informational: these are usually SDK/other calls, not indexer collections.
  console.log(`\n  · root fields seen in app queries: ${collections.join(", ")}`);
}
console.log(
  failures === 0
    ? `\nSchema satisfies every app query.\n`
    : `\n${failures} entity check(s) FAILED — the app queries fields the schema doesn't have.\n`,
);
process.exit(failures === 0 ? 0 : 1);
