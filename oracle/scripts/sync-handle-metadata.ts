import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { planSync, decodeHandleId, type IndexerHandleMeta } from "../src/registry/handle-metadata-sync";

/**
 * Sync handle metadata (name / symbol / photo / categories) from the INDEXER
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
const INDEXER_URL =
  process.env.INDEXER_URL ?? "http://localhost:8080/v1/graphql";

const HANDLES_QUERY = `{
  Handle(limit: 500, where: { active: { _eq: true } }, order_by: { aura: desc }) {
    id name symbol metadata owner { id } categories
  }
}`;

async function gql(query: string): Promise<IndexerHandleMeta[]> {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: { Handle?: IndexerHandleMeta[] };
    errors?: { message?: string }[];
  };
  if (json.errors?.length) throw new Error(json.errors[0]?.message ?? "graphql error");
  return json.data?.Handle ?? [];
}

async function fetchHandles(): Promise<IndexerHandleMeta[]> {
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
  console.log(`handles from indexer: ${handles.length}${only ? ` (filter: ${only})` : ""}`);

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
