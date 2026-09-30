/**
 * Human URLs for handles. A handle id on-chain is bytes32 (`0x726f6e…`) and a
 * label is written `@ronaldo` — neither belongs in a user-facing URL. Every
 * link uses a lowercase slug instead (`/ronaldo`); lookups accept both the slug
 * and the raw id so old links keep working.
 */
import type { SubgraphHandle } from "@/queries/handles";

/** Decode a left-aligned ASCII bytes32 ("0x6d65…" → "messi"). */
export function decodeBytes32(hex: string): string | null {
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

export function isBytes32(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

/** Display label for a raw handle id — decoded when it's bytes32. */
export function labelOf(idOrLabel: string): string {
  const raw = idOrLabel.replace(/^@/, "");
  return decodeBytes32(raw) ?? raw;
}

/** URL-safe slug from a label ("Elon Musk" → "elon-musk", "@btc" → "btc"). */
function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "market"
  );
}

/**
 * URL slug: lowercase, url-safe, never bytes32, never `@`.
 *
 * The on-chain id is the authoritative identity: when it decodes to ASCII
 * bytes32 (`0x656c6f6e…` → "elon") that decoded label IS the canonical slug, so
 * a handle whose display name is "Elon Musk" still links to `/elon`. Only when
 * the id isn't decodable does the display name/symbol decide — otherwise a
 * cosmetic rename would move the URL and could point at a handle that no longer
 * matches the subgraph id.
 */
export function handleSlug(
  source: { id: string; name?: string | null; symbol?: string | null } | string,
): string {
  const label =
    typeof source === "string"
      ? labelOf(source)
      : // The id wins whenever it is decodable ASCII.
        (decodeBytes32(source.id) ?? source.name ?? source.symbol ?? labelOf(source.id));
  return slugify(label || (typeof source === "string" ? source : source.id));
}

export function handleHref(h: Pick<SubgraphHandle, "id" | "name" | "symbol">): string {
  return `/${handleSlug(h)}`;
}

/**
 * Normalise a handle key for tolerant comparison: strip `@`, lowercase, and
 * collapse spaces/underscores to `-` — so "elon musk", "elon_musk" and
 * "elon-musk" all agree, on BOTH sides of the comparison.
 */
function normaliseKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[\s_]+/g, "-");
}

/**
 * Can this URL param identify this handle? Matches, case-insensitively, by raw
 * id, decoded label, canonical slug, symbol and the normalised display name.
 */
export function matchesParam(
  h: Pick<SubgraphHandle, "id" | "name" | "symbol">,
  param: string,
): boolean {
  const p = normaliseKey(param);
  if (!p) return false;
  return [
    normaliseKey(h.id),
    normaliseKey(labelOf(h.id)),
    normaliseKey(handleSlug(h)),
    normaliseKey(h.name ?? ""),
    normaliseKey(h.symbol ?? ""),
  ].includes(p);
}

/** Resolve a URL param (`ronaldo`, `@ronaldo`, `0x726f…`) to a handle. */
export function findHandle<T extends Pick<SubgraphHandle, "id" | "name" | "symbol">>(
  handles: T[] | undefined,
  param: string,
): T | undefined {
  if (!handles?.length) return undefined;
  let decoded = param;
  try {
    decoded = decodeURIComponent(param);
  } catch {
    /* malformed escape — compare the raw param */
  }
  return (
    handles.find((h) => h.id.toLowerCase() === param.toLowerCase()) ??
    handles.find((h) => matchesParam(h, decoded))
  );
}

/** `@ronaldo` — the display form, never raw bytes32. */
export function atHandle(label: string): string {
  return `@${labelOf(label)}`;
}
