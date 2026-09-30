/**
 * Route smoke test — fetches every page and asserts it renders (200 + a marker
 * string from that page). Catches the class of failure we hit repeatedly:
 * a route that 200s while rendering the error boundary, or a redirect stub that
 * swallows a real page.
 *
 *   node scripts/check-routes.mjs [baseUrl]
 */
const BASE = process.argv[2] ?? "http://localhost:5173";

/** [path, a string that must appear in the HTML] */
const ROUTES = [
  ["/", "Everything has an $AURA"],
  ["/feeds", "For you"],
  ["/leaderboard", "Leaderboard"],
  ["/pool", "Liquidity pool"],
  ["/portfolio", "Portfolio"],
  ["/saved", "Saved"],
  ["/notifications", "Notifications"],
  ["/terms", "Terms"],
  ["/privacy", "Privacy"],
];

let failures = 0;
console.log(`Route smoke test · ${BASE}\n`);

for (const [path, marker] of ROUTES) {
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: "follow" });
    const html = await res.text();
    const bad = /This page didn't load|Something went wrong on our end/.test(html);
    const ok = res.ok && html.includes(marker) && !bad;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "✓" : "✗"} ${path.padEnd(16)} ${res.status} · ${
        bad ? "ERROR BOUNDARY" : html.includes(marker) ? `marker "${marker}"` : `marker "${marker}" MISSING`
      }`,
    );
  } catch (e) {
    failures++;
    console.log(`  ✗ ${path.padEnd(16)} ${e.message}`);
  }
}

// A dynamic handle page: the indexer must supply at least one to test.
try {
  const body = JSON.stringify({
    query: "{ Handle(where: { active: { _eq: true } }, limit: 1) { name } }",
  });
  const sub = await fetch("http://localhost:8080/v1/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }).then((r) => r.json());
  const slug = String(sub?.data?.Handle?.[0]?.name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  if (slug) {
    const res = await fetch(`${BASE}/${slug}`);
    const html = await res.text();
    const ok = res.ok && html.includes("Feeds") && !/didn't load/.test(html);
    if (!ok) failures++;
    console.log(`  ${ok ? "✓" : "✗"} /${slug.padEnd(15)} ${res.status} · handle page`);
  }
} catch {
  console.log("  – handle page skipped (indexer unreachable)");
}

console.log(failures === 0 ? "\nAll routes render.\n" : `\n${failures} route(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
