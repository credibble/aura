/**
 * The on-chain handle metadata JSON, parsed once and shared.
 *
 * It rides as a STRING in `Handle.metadata` (set by the seed script and by the
 * oracle's profile updates), and it is where a handle's real artwork lives
 * (`photo` + `imageFit`). Every avatar path funnels through here so a photo is
 * never silently dropped — the previous split (one parser in the query layer,
 * none in the component) meant only some surfaces showed the image.
 */
/** Per-handle themed-character config — archetype, palette, emoji fallback. */
export type HandleCharacter = {
  /** Archetype that frames the handle (athlete, musician, brand, crypto, …). */
  type?: string;
  /** For person/group handles; "none" for brands and concepts. */
  gender?: string;
  /** A representative emoji — cheap avatar fallback before a Jazzicon. */
  emoji?: string;
  /** Palette for card gradients / avatar backdrop (hex strings). */
  colors?: { primary?: string; secondary?: string; accent?: string };
  /**
   * Appearance overrides the user picked in "Start farming aura" — indices into
   * the vector sprite's own palettes. The sprite hashes these from the handle id
   * by default; a saved `look` wins so the user's character is theirs. Kept as
   * small integers to stay inside the on-chain metadata's 512-char budget.
   */
  look?: {
    /** Index into the skin-tone palette. */
    skin?: number;
    /** Index into the hair-colour palette. */
    hair?: number;
    /** Index into the hair-style palette. */
    style?: number;
    /** Index into the outfit-colour palette. */
    outfit?: number;
  };
};

export type HandleMetadata = {
  name?: string;
  symbol?: string;
  /** Absolute https URL of the handle's photo/logo. */
  photo?: string;
  /** "contain" keeps transparent logos uncropped; photos default to cover. */
  imageFit?: "cover" | "contain";
  category?: string | number;
  /** Themed-character config (seeded) — drives UI theming when present. */
  character?: HandleCharacter;
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
    character: parseCharacter(o.character),
  };
}

/** Parse the nested `character` object — never throws, every field optional. */
function parseCharacter(raw: unknown): HandleCharacter | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const c = raw as Record<string, unknown>;
  const cr = c.colors;
  const colors = cr && typeof cr === "object" && !Array.isArray(cr) ? (cr as Record<string, unknown>) : undefined;
  const lr = c.look;
  const lookRaw = lr && typeof lr === "object" && !Array.isArray(lr) ? (lr as Record<string, unknown>) : undefined;
  const asIndex = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
  const look = lookRaw
    ? {
        skin: asIndex(lookRaw.skin),
        hair: asIndex(lookRaw.hair),
        style: asIndex(lookRaw.style),
        outfit: asIndex(lookRaw.outfit),
      }
    : undefined;
  return {
    type: typeof c.type === "string" ? c.type : undefined,
    gender: typeof c.gender === "string" ? c.gender : undefined,
    emoji: typeof c.emoji === "string" ? c.emoji : undefined,
    colors: colors
      ? {
          primary: typeof colors.primary === "string" ? colors.primary : undefined,
          secondary: typeof colors.secondary === "string" ? colors.secondary : undefined,
          accent: typeof colors.accent === "string" ? colors.accent : undefined,
        }
      : undefined,
    look,
  };
}

/** Just the artwork bits an avatar needs. */
export function artworkOf(
  raw: string | Record<string, unknown> | null | undefined,
): { image?: string; imageFit?: "cover" | "contain" } {
  const meta = parseHandleMetadata(raw);
  return { image: meta.photo, imageFit: meta.imageFit ?? "cover" };
}
