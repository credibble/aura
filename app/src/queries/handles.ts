/**
 * Handle/asset queries — read DIRECTLY from the subgraph (no backend
 * intermediary). One handles query carries each handle's latest window +
 * aura history so the client maps straight to `LiveAsset`.
 */
import { useCallback } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gql } from "@/lib/graphql";
import { aura, type HandleVerifyResult } from "@/lib/privy";
import { artworkOf } from "@/lib/handle-metadata";
import { CATEGORY_MAP, type CategoryId, type LiveAsset } from "@/lib/aura-data";
import { qk } from "./keys";

export type SubgraphHandle = {
  id: string;
  contract: string;
  stake: string;
  name: string | null;
  symbol: string | null;
  metadata: string | null;
  sources: string[];
  aura: string;
  auraDelta: string;
  graduated: boolean;
  verified: boolean;
  /** On-chain category codes (100_001_001 → family codes). */
  categories: string[];
  /** Family ids derived from the codes — `["sports"]`. */
  categoryIds: string[];
  windowMinutes: string;
  active: boolean;
  windowCount: number;
  auraHistory: { aura: string; summary: string | null; timestamp: string }[];
  windows: {
    id: string;
    windowStart: string;
    windowEnd: string;
    outcomes: string[];
    settled: boolean;
    prices: string[];
    volume: string;
  }[];
};

/** Full selection used by both the public list and the wallet's own handles. */
export const HANDLE_FIELDS = `id contract stake name symbol metadata sources aura auraDelta graduated verified categories categoryIds windowMinutes active windowCount`;

/**
 * The same fields PLUS the derived history the explore cards draw: the aura
 * series (sparkline) and the newest window (volume + outcomes).
 */
export const HANDLE_CARD_FIELDS = `${HANDLE_FIELDS}
  auraHistory(first: 64, orderBy: timestamp, orderDirection: desc) { aura summary timestamp }
  windows(first: 1, orderBy: windowStart, orderDirection: desc) {
    id windowStart windowEnd outcomes settled prices volume
  }`;

const HANDLES_QUERY = `{
  handles(where: { active: true }, orderBy: aura, orderDirection: desc, first: 200) {
    ${HANDLE_FIELDS}
    auraHistory(first: 64, orderBy: timestamp, orderDirection: desc) { aura summary timestamp }
    windows(first: 1, orderBy: windowStart, orderDirection: desc) {
      id windowStart windowEnd outcomes settled prices volume
    }
  }
}`;

export const handlesQueryOptions = queryOptions({
  queryKey: qk.handles,
  queryFn: async () => (await gql<{ handles: SubgraphHandle[] }>(HANDLES_QUERY)).handles,
  staleTime: 10_000,
  // No poll: `aura`/`window` push messages invalidate handles live.
});

export type PersonHit = {
  id: string;
  name: string | null;
  symbol: string | null;
  aura: string;
  auraDelta: string;
  verified: boolean;
};

export type HandleSearchHit = PersonHit & {
  categories: string[];
  categoryIds: string[];
  graduated: boolean;
};

/**
 * Handle search — the subgraph does the matching (`name_contains` /
 * `symbol_contains`), so the app never scans a full list client-side.
 */
export function handleSearchOptions(q: string, limit = 8) {
  const needle = q.trim();
  return queryOptions({
    queryKey: qk.handleSearch(needle),
    queryFn: async () =>
      (
        await gql<{ handles: HandleSearchHit[] }>(
          `query Handles($q: String!) {
            handles(
              where: {
                active: true
                or: [{ name_contains_nocase: $q }, { symbol_contains_nocase: $q }]
              }
              orderBy: aura
              orderDirection: desc
              first: ${limit}
            ) {
              id name symbol aura auraDelta verified categories categoryIds graduated
            }
          }`,
          { q: needle },
        )
      ).handles,
    enabled: needle.length > 0,
    staleTime: 5_000,
  });
}

/** People search — subgraph `name_contains`, first 6 active handles. */
export function peopleSearchOptions(q: string) {
  const needle = q.trim();
  return queryOptions({
    queryKey: qk.peopleSearch(needle),
    queryFn: async () =>
      (
        await gql<{ handles: PersonHit[] }>(
          `query People($q: String!) {
            handles(where: { name_contains: $q, active: true }, orderBy: aura, orderDirection: desc, first: 6) {
              id name symbol aura auraDelta verified
            }
          }`,
          { q: needle },
        )
      ).handles,
    enabled: needle.length > 0,
    staleTime: 5_000,
  });
}

/** Category code → the app's category id (sport-family codes → sports). */
export function categoryFromCode(code: string): CategoryId {
  const n = Number(code);
  if (Number.isNaN(n)) return "culture";
  const cat = Math.floor(n / 1_000_000) % 1_000;
  if (cat === 100) return "sports";
  if (cat === 1) return "crypto";
  if (cat === 2) return "ai";
  if (cat === 3) return "people";
  if (cat === 4) return "brands";
  if (cat === 5) return "memes";
  if (cat === 6) return "music";
  if (cat === 7) return "tech";
  if (cat === 8) return "culture";
  return "culture";
}

/**
 * A handle's category list, mapped to the app's category ids. The subgraph
 * carries both the derived family ids (`categoryIds: [String!]!`) and the raw
 * on-chain codes (`categories: [BigInt!]!`); prefer the ids and fall back to
 * decoding the codes. Never empty — an unlabelled handle reads as "culture", so
 * no caller has to guard against a missing category.
 */
export function categoriesOf(h: {
  categories?: string[] | null;
  categoryIds?: string[] | null;
}): CategoryId[] {
  const ids = (h.categoryIds ?? []).filter((id): id is CategoryId =>
    Object.prototype.hasOwnProperty.call(CATEGORY_MAP, id),
  );
  const uniqIds = [...new Set(ids)];
  if (uniqIds.length > 0) return uniqIds;
  const codes = [...new Set((h.categories ?? []).map(categoryFromCode))];
  return codes.length > 0 ? codes : ["culture"];
}

const WINDOW_MINUTES_OPTIONS: { short: string; long: string; minutes: number }[] = [
  { short: "15m", long: "15-minute", minutes: 15 },
  { short: "30m", long: "30-minute", minutes: 30 },
  { short: "1h", long: "1-hour", minutes: 60 },
  { short: "2h", long: "2-hour", minutes: 120 },
  { short: "4h", long: "4-hour", minutes: 240 },
  { short: "8h", long: "8-hour", minutes: 480 },
  { short: "1d", long: "1-day", minutes: 1440 },
];

export function windowLabels(minutes: number): { short: string; long: string } {
  const exact = WINDOW_MINUTES_OPTIONS.find((w) => w.minutes === minutes);
  if (exact) return { short: exact.short, long: exact.long };
  const nearest = WINDOW_MINUTES_OPTIONS.reduce((best, w) =>
    Math.abs(w.minutes - minutes) < Math.abs(best.minutes - minutes) ? w : best,
  );
  return { short: nearest.short, long: nearest.long };
}

/**
 * The handle's real artwork from its metadata JSON.
 *
 * NOTE the shape: `artworkOf` returns `{ image, imageFit }` (not `{ photo }`) —
 * reading `.photo` off it silently yielded `undefined`, which made EVERY handle
 * fall back to a Jazzicon. Parsing lives in one place (`lib/handle-metadata`) so
 * the two shapes can't drift again.
 */
function metadataOf(raw: string | null | undefined): {
  image?: string;
  imageFit?: "cover" | "contain";
} {
  return artworkOf(raw);
}

/** Map a subgraph handle to the app's LiveAsset (real aura + history). */
export function toLiveAsset(h: SubgraphHandle): LiveAsset {
  const aura = Number(h.aura) / 100;
  // Derived collections are optional: list queries can select the scalar fields
  // only, so never assume `auraHistory`/`windows` came back.
  const rawHistory = h.auraHistory ?? [];
  const history = [...rawHistory].map((p) => Number(p.aura) / 100).reverse();
  // Latest AuraUpdated push delta, straight from the subgraph (1e2 → points).
  const change = Number(h.auraDelta) / 100;
  const w = (h.windows ?? [])[0];
  // The seeded/edited profile photo lives in the on-chain metadata JSON.
  const art = metadataOf(h.metadata);
  const categories = categoriesOf(h);
  return {
    id: h.id,
    symbol: (h.symbol ?? "?").toUpperCase().slice(0, 4),
    name: h.name ?? h.symbol ?? h.id,
    // Primary label kept for the single-category surfaces; `categories` is the
    // full on-chain list.
    category: categories[0]!,
    categories,
    color: "hsl(var(--primary))",
    image: art.image,
    imageFit: art.imageFit ?? "cover",
    // Keep the raw blob too: <Avatar> parses it itself, so any surface that
    // forwards the asset shows the real artwork without a lookup.
    metadata: h.metadata,
    summary: rawHistory[0]?.summary ?? "",
    index: aura,
    change,
    volume: w ? Number(w.volume) / 1e18 : 0,
    history: history.length ? history : [aura],
    spark: (history.length ? history : [aura]).slice(-12),
    windowMinutes: Number(h.windowMinutes),
    metric: "aura",
  };
}

export function useHandles() {
  return useQuery(handlesQueryOptions);
}

/** Real artwork for a handle, resolved from the loaded handle list. */
export type HandleArtwork = { image?: string; imageFit?: "cover" | "contain" };

/**
 * Resolve a handle's photo by ANY identifier the UI happens to hold — handleId,
 * name, symbol, or "@label". Rows that only know a label (position tables, order
 * tickets) can then show the real artwork instead of a Jazzicon; the identicon
 * stays the fallback when there is no photo (or the key matches nothing).
 */
export function useHandleArtwork(): (key: string | null | undefined) => HandleArtwork {
  const { data } = useHandles();
  return useCallback(
    (key: string | null | undefined): HandleArtwork => {
      if (!key) return {};
      const raw = key.trim();
      const needle = raw.replace(/^@/, "").toLowerCase();
      const found = (data ?? []).find(
        (h) =>
          h.id.toLowerCase() === raw.toLowerCase() ||
          (h.name ?? "").toLowerCase() === needle ||
          (h.symbol ?? "").toLowerCase() === needle,
      );
      if (!found) return {};
      return metadataOf(found.metadata);
    },
    [data],
  );
}

export function useHandle(id: string | undefined) {
  const { data, ...rest } = useQuery({
    ...handlesQueryOptions,
    select: (handles) =>
      id ? handles.find((h) => h.id === id || h.id.toLowerCase() === id.toLowerCase()) : undefined,
  });
  return { handle: data, ...rest };
}

/** On-chain Cleanverse CVI flag for a handle (`Handle.verified`). */
export function handleVerifiedOptions(handleId: string | undefined) {
  return queryOptions({
    queryKey: qk.handleVerified(handleId ?? ""),
    queryFn: () => aura.handleVerified(handleId!),
    enabled: Boolean(handleId),
    staleTime: 15_000,
  });
}

export function useHandleVerified(handleId: string | undefined) {
  return useQuery(handleVerifiedOptions(handleId));
}

/** Verify the handle's creator via Cleanverse → backend writes on-chain. */
export function useVerifyHandle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (handleId: string): Promise<HandleVerifyResult> => aura.verifyHandle(handleId),
    onSuccess: (_data, handleId) => {
      void qc.invalidateQueries({ queryKey: qk.handleVerified(handleId) });
      void qc.invalidateQueries({ queryKey: qk.handles });
    },
  });
}
