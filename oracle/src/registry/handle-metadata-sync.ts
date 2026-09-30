/**
 * Handle metadata → Postgres `users.metadata`.
 *
 * The subgraph is authoritative for a handle (name, symbol, photo, categories);
 * Postgres keeps a copy for the surfaces the oracle owns — comment authors, feeds
 * and notifications all read the PG user. Nothing kept that copy in sync, so a
 * renamed handle or a new photo showed up on-chain and in the subgraph while the
 * PG-backed rows kept the old values forever.
 *
 * The pure part lives here (tested); `scripts/sync-handle-metadata.ts` is the CLI.
 */
export type SubgraphHandleMeta = {
  id: string;
  name?: string | null;
  symbol?: string | null;
  metadata?: string | null;
  owner?: { id?: string | null } | null;
  categoryIds?: string[] | null;
};

export type ParsedHandleMeta = {
  handleId: string;
  /** The PG `users` row this handle's owner maps to (their wallet address). */
  userId: string;
  name: string;
  symbol: string;
  photo?: string;
  imageFit?: "cover" | "contain";
  categories: string[];
};

/** Parse the on-chain metadata JSON + identity fields, tolerant of junk. */
export function parseHandleMeta(row: SubgraphHandleMeta): ParsedHandleMeta | null {
  const userId = (row.owner?.id ?? "").toLowerCase();
  if (!row.id || !/^0x[0-9a-f]{64}$/i.test(row.id) || !/^0x[0-9a-f]{40}$/i.test(userId)) return null;

  let meta: Record<string, unknown> = {};
  const raw = (row.metadata ?? "").trim();
  if (raw.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      /* malformed blob — fall back to the identity fields */
    }
  }
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  const label = decodeHandleId(row.id);
  const fit = meta.imageFit === "contain" || meta.imageFit === "cover" ? meta.imageFit : undefined;

  return {
    handleId: row.id.toLowerCase(),
    userId,
    name: str(meta.name) ?? row.name ?? label,
    symbol: str(meta.symbol) ?? row.symbol ?? "",
    photo: str(meta.photo),
    imageFit: fit,
    categories: [...new Set((row.categoryIds ?? []).filter((c) => typeof c === "string" && c))],
  };
}

/** bytes32 handleId → its ASCII label ("0x656c6f6e…" → "elon"). */
export function decodeHandleId(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length !== 64) return hex;
  let out = "";
  for (let i = 0; i < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code === 0) break;
    if (code < 0x20 || code > 0x7e) return hex;
    out += String.fromCharCode(code);
  }
  return out || hex;
}

/** The metadata object written into `users.metadata` (merged, never clobbering). */
export function userMetadataPatch(parsed: ParsedHandleMeta): Record<string, unknown> {
  return {
    handleId: parsed.handleId,
    handle: `@${decodeHandleId(parsed.handleId)}`,
    name: parsed.name,
    symbol: parsed.symbol,
    ...(parsed.photo ? { photo: parsed.photo } : {}),
    ...(parsed.imageFit ? { imageFit: parsed.imageFit } : {}),
    categories: parsed.categories,
    syncedAt: new Date().toISOString(),
  };
}

/** Merge a patch over an existing `users.metadata` blob (existing keys win if unknown). */
export function mergeUserMetadata(
  existing: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return { ...base, ...patch };
}

export type SyncPlan = {
  userId: string;
  handleId: string;
  /** The handle's ASCII label, for logging ("elon"). */
  label: string;
  action: "create" | "update" | "unchanged";
  metadata: Record<string, unknown>;
};

/**
 * Decide what to write for each handle. `existingUsers` maps wallet address →
 * the row's current `metadata` (undefined when the row doesn't exist).
 */
export function planSync(
  rows: SubgraphHandleMeta[],
  existingUsers: Map<string, unknown>,
): SyncPlan[] {
  const plans: SyncPlan[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const parsed = parseHandleMeta(row);
    if (!parsed) continue;
    // One handle per user in practice; if an owner has several, the newest wins
    // and it is reported once.
    if (seen.has(parsed.userId)) continue;
    seen.add(parsed.userId);

    const patch = userMetadataPatch(parsed);
    const label = decodeHandleId(parsed.handleId);
    const before = existingUsers.get(parsed.userId);
    if (before === undefined) {
      plans.push({ ...parsed, label, action: "create", metadata: patch });
      continue;
    }
    const merged = mergeUserMetadata(before, patch);
    const same =
      JSON.stringify({ ...merged, syncedAt: undefined }) ===
      JSON.stringify({ ...(before as object), syncedAt: undefined });
    plans.push({ ...parsed, label, action: same ? "unchanged" : "update", metadata: merged });
  }
  return plans;
}
