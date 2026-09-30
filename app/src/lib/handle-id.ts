/**
 * Human URLs for handles. A handle id on-chain is bytes32 (`0x726f6e…`) and a
 * label is written `@ronaldo` — neither belongs in a user-facing URL. Every
 * link uses a lowercase slug instead (`/trade/ronaldo`); lookups accept both the
 * slug and the raw id so old links keep working.
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

/** URL slug: lowercase, url-safe, never bytes32, never `@`. Prefers the
 *  handle's human name ("ronaldo") over its ticker ("ron") so links read. */
export function handleSlug(
  source: { id: string; name?: string | null; symbol?: string | null } | string,
): string {
  const label =
    typeof source === "string"
      ? labelOf(source)
      : (source.name ?? source.symbol ?? labelOf(source.id));
  const slug = (label || labelOf(typeof source === "string" ? source : source.id))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "market";
}

export function handleHref(h: Pick<SubgraphHandle, "id" | "name" | "symbol">): string {
  return `/${handleSlug(h)}`;
}

/** Can this URL param identify this handle? (slug, name, symbol, or raw id) */
export function matchesParam(
  h: Pick<SubgraphHandle, "id" | "name" | "symbol">,
  param: string,
): boolean {
  const p = param.toLowerCase().replace(/^@/, "");
  return [
    handleSlug(h),
    labelOf(h.id).toLowerCase(),
    (h.name ?? "").toLowerCase(),
    (h.symbol ?? "").toLowerCase(),
    h.id.toLowerCase(),
  ].includes(p);
}

/** Resolve a URL param (`ronaldo`, `@ronaldo`, `0x726f…`) to a handle. */
export function findHandle<T extends Pick<SubgraphHandle, "id" | "name" | "symbol">>(
  handles: T[] | undefined,
  param: string,
): T | undefined {
  if (!handles?.length) return undefined;
  return (
    handles.find((h) => h.id.toLowerCase() === param.toLowerCase()) ??
    handles.find((h) => matchesParam(h, decodeURIComponent(param)))
  );
}

/** `@ronaldo` — the display form, never raw bytes32. */
export function atHandle(label: string): string {
  return `@${labelOf(label)}`;
}
