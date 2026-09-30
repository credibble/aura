import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { planSync, decodeHandleId, type SubgraphHandleMeta } from "../src/registry/handle-metadata-sync";

/**
 * Sync handle metadata (name / symbol / photo / categories) from the SUBGRAPH
 * into Postgres `users.metadata`, so the oracle-owned surfaces — comment authors,
 * feeds, notifications — show the same identity as the on-chain handle.
 *
 *   npx tsx scripts/sync-handle-metadata.ts            # dry run (default)
 *   npx tsx scripts/sync-handle-metadata.ts --apply    # write
 *   npx tsx scripts/sync-handle-metadata.ts --apply --handle elon
 *
 * Idempotent: re-running after a rename/photo change reports `update` once and
 * then `unchanged`.
 */
const SUBGRAPH_URL =
  process.env.SUBGRAPH_URL ?? "http://localhost:8000/subgraphs/name/aura/aura";

const HANDLES_QUERY = `{
  handles(first: 500, where: { active: true }, orderBy: aura, orderDirection: desc) {
    id name symbol metadata owner { id } categoryIds
  }
}`;

/** Pre-migration fallback: the field was `categoryId` (single) before it became a list. */
const HANDLES_QUERY_LEGACY = HANDLES_QUERY.replace("categoryIds", "categoryId");

async function gql(query: string): Promise<SubgraphHandleMeta[]> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`subgraph HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: { handles?: SubgraphHandleMeta[] };
    errors?: { message?: string }[];
  };
  if (json.errors?.length) throw new Error(json.errors[0]?.message ?? "graphql error");
  return (json.data?.handles ?? []).map((h) => ({
    ...h,
    // Tolerate the single-category form so the script works before and after the
    // `categoryId` → `categoryIds` migration.
    categoryIds: h.categoryIds ?? (h.categoryId ? [h.categoryId] : []),
  }));
}

async function fetchHandles(): Promise<SubgraphHandleMeta[]> {
  return gql(HANDLES_QUERY);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const onlyIdx = process.argv.indexOf("--handle");
  const only = onlyIdx > -1 ? (process.argv[onlyIdx + 1] ?? "").toLowerCase() : null;

  const prisma = new PrismaClient();
  const handles = (await fetchHandles()).filter((h) => {
    if (!only) return true;
    return decodeHandleId(h.id).toLowerCase() === only;
  });
  console.log(`handles from subgraph: ${handles.length}${only ? ` (filter: ${only})` : ""}`);

  // Current PG rows for the owners involved.
  const owners = [...new Set(handles.map((h) => (h.owner?.id ?? "").toLowerCase()).filter(Boolean))];
  const rows = await prisma.user.findMany({
    where: { id: { in: owners } },
    select: { id: true, metadata: true },
  });
  const existing = new Map<string, unknown>(rows.map((r) => [r.id.toLowerCase(), r.metadata]));

  const plans = planSync(handles, existing);
  const counts = { create: 0, update: 0, unchanged: 0 };
  for (const p of plans) {
    counts[p.action] += 1;
    console.log(`  ${p.action.padEnd(9)} @${p.label.padEnd(10)} ${p.userId}${p.photo ? "  +photo" : ""}`);
  }

  if (!apply) {
    console.log(
      `\nDRY RUN — would create ${counts.create}, update ${counts.update}, skip ${counts.unchanged}. Re-run with --apply.`,
    );
    await prisma.$disconnect();
    return;
  }

  for (const p of plans) {
    if (p.action === "unchanged") continue;
    await prisma.user.upsert({
      where: { id: p.userId },
      create: { id: p.userId, metadata: p.metadata as object },
      update: { metadata: p.metadata as object },
    });
  }
  console.log(
    `\nAPPLIED — created ${counts.create}, updated ${counts.update}, unchanged ${counts.unchanged}.`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
