/**
 * The on-chain handle metadata JSON, parsed once and shared.
 *
 * It rides as a STRING in `Handle.metadata` (set by the seed script and by the
 * oracle's profile updates), and it is where a handle's real artwork lives
 * (`photo` + `imageFit`). Every avatar path funnels through here so a photo is
 * never silently dropped — the previous split (one parser in the query layer,
 * none in the component) meant only some surfaces showed the image.
 */
export type HandleMetadata = {
  name?: string;
  symbol?: string;
  /** Absolute https URL of the handle's photo/logo. */
  photo?: string;
  /** "contain" keeps transparent logos uncropped; photos default to cover. */
  imageFit?: "cover" | "contain";
  category?: string | number;
};

/** Parse metadata from a JSON string, an object, or nothing — never throws. */
export function parseHandleMetadata(
  raw: string | Record<string, unknown> | null | undefined,
): HandleMetadata {
  if (!raw) return {};
  let value: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text.startsWith("{")) return {};
    try {
      value = JSON.parse(text);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const o = value as Record<string, unknown>;
  const strings = {
    name: typeof o.name === "string" ? o.name : undefined,
    symbol: typeof o.symbol === "string" ? o.symbol : undefined,
    photo: typeof o.photo === "string" && o.photo ? o.photo : undefined,
  };
  const fit = o.imageFit;
  return {
    ...strings,
    imageFit: fit === "contain" || fit === "cover" ? fit : undefined,
    category:
      typeof o.category === "string" || typeof o.category === "number" ? o.category : undefined,
  };
}

/** Just the artwork bits an avatar needs. */
export function artworkOf(
  raw: string | Record<string, unknown> | null | undefined,
): { image?: string; imageFit?: "cover" | "contain" } {
  const meta = parseHandleMetadata(raw);
  return { image: meta.photo, imageFit: meta.imageFit ?? "cover" };
}
