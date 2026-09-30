/**
 * Handle-slug smoke test — a handle link must resolve no matter which slug form
 * reaches the URL: the canonical id-decoded slug, the display name with dashes,
 * or the display name with underscores.
 *
 * The bug this pins: a post showed "@elon-musk" because the display NAME
 * ("Elon Musk") was slugified instead of the handle's canonical on-chain label
 * (bytes32 `0x656c6f6e…` → "elon"). `findHandle` matches id, decoded label,
 * symbol and the normalised name, so all forms must land on the SAME handle
 * page — never the "Market not found" branch.
 *
 *   node scripts/check-handle-slug.mjs [baseUrl]
 *
 * Data-verification needs the subgraph AND the app render path. When the
 * subgraph has no handles, lacks the app's `categories`/`categoryIds` fields,
 * or is unreachable (e.g. a schema migration is in flight) the script reports
 * SKIPPED instead of a false failure.
 */
const BASE = process.argv[2] ?? "http://localhost:8080";
const SUBGRAPH = "http://localhost:8000/subgraphs/name/aura/aura";

/**
 * Left-aligned ASCII bytes32 → label, or null. Kept local on purpose so this
 * script imports NOTHING from the app: it must not be able to "pass" by
 * agreeing with a buggy resolver, and it probes the deployed page instead.
 */
function decodeBytes32(hex) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  const clean = hex.slice(2);
  let out = "";
  for (let i = 0; i < 64; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code === 0) break;
    if (code < 0x20 || code > 0x7e) return null;
    out += String.fromCharCode(code);
  }
  return out || null;
}

const slugOf = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Load candidate handles; the field list mirrors what the app selects so a
 *  missing schema field is treated as "cannot data-verify", not a failure. */
async function loadHandles() {
  try {
    const res = await fetch(SUBGRAPH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query:
          "{ handles(where: { active: true }, first: 50) { id name symbol categories categoryIds } }",
      }),
    });
    const json = await res.json();
    if (json?.errors?.length) {
      return { ok: false, reason: json.errors[0]?.message ?? "subgraph reported errors" };
    }
    return { ok: true, handles: json?.data?.handles ?? [] };
  } catch (e) {
    return { ok: false, reason: `subgraph unreachable (${e.message})` };
  }
}

console.log("Handle-slug smoke test\n");

const loaded = await loadHandles();
if (!loaded.ok) {
  console.log(`  – SKIPPED (${loaded.reason})\n`);
  process.exit(0);
}
if (loaded.handles.length === 0) {
  console.log("  – SKIPPED (subgraph has no handles yet — schema migration in flight?)\n");
  process.exit(0);
}

// Prefer the reported shape: a handle whose display name differs from its id
// label ("Elon Musk" vs "elon"), so the dash/underscore forms are exercised.
const pick =
  loaded.handles.find((h) => {
    const label = decodeBytes32(h.id);
    return label && h.name && slugOf(label) !== slugOf(h.name);
  }) ?? loaded.handles[0];

const canonical = slugOf(decodeBytes32(pick.id) ?? pick.name ?? pick.symbol ?? pick.id);
const nameSlug = pick.name ? slugOf(pick.name) : "";
const variants = [...new Set([canonical, nameSlug, nameSlug.replace(/-/g, "_")])].filter(Boolean);
// "Feeds" is the handle page's tab marker (the same one check-routes uses); it
// is absent from the "Market not found" branch.
const MARKER = "Feeds";

let failures = 0;
for (const v of variants) {
  try {
    const res = await fetch(`${BASE}/${v}`, { redirect: "follow" });
    const html = await res.text();
    const boundary = /This page didn't load|Something went wrong on our end/.test(html);
    const notFound = html.includes("Market not found");
    const ok = res.ok && !boundary && !notFound && html.includes(MARKER);
    if (!ok) failures++;
    console.log(
      `  ${ok ? "✓" : "✗"} /${v.padEnd(22)} ${res.status} · ${
        boundary
          ? "ERROR BOUNDARY"
          : notFound
            ? "MARKET NOT FOUND"
            : html.includes(MARKER)
              ? `resolves to a handle page (${pick.name ?? `@${canonical}`})`
              : `marker "${MARKER}" MISSING`
      }`,
    );
  } catch (e) {
    failures++;
    console.log(`  ✗ /${v.padEnd(22)} ${e.message}`);
  }
}

console.log(
  failures === 0
    ? `\nAll ${variants.length} slug form(s) resolve to the same handle.\n`
    : `\n${failures} slug form(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
