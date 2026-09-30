/**
 * The market-style taxonomy — the handle's `category` code determines the style
 * and metadata of its prediction windows (the oracle's `openWindow` question).
 *
 * Encoding: `{cat}_{sub}_{format}`
 *   cat     = 100_000_000 × base category        (100_000_000 = sport)
 *   sub     = cat + 1_000 × sub-category         (100_001_000 = football, 100_002_000 = basket_ball)
 *  format  = sub + 1 = binary YES/NO            (100_001_001 → "will @arsenal aura rise above 30.40?")
 *           = sub + 2 = multi-outcome             (100_001_002 → "who will gain the highest aura from window start to end?")
 */

export type MarketStyleName = "binary" | "multi";

export interface MarketStyle {
  category: number;
  /** Base category (e.g. 100_000_000). */
  cat: number;
  /** Sub-category (e.g. 100_001_000). */
  sub: number;
  /** Format: 0 = bare category root (binary default), 1 = binary, 2 = multi. */
  format: 0 | 1 | 2;
  style: MarketStyleName;
  /** Base label ("sport"). */
  base: string;
  /** Sub-category label ("football"). */
  subLabel: string;
}

export const CATEGORY_BASE = 100_000_000;
const SUB_STEP = 1_000;

const BASE_LABELS: Record<number, string> = {
  [CATEGORY_BASE]: "sport",
};

const SUB_LABELS: Record<number, string> = {
  [CATEGORY_BASE + SUB_STEP]: "football",
  [CATEGORY_BASE + 2 * SUB_STEP]: "basket_ball",
  [CATEGORY_BASE + 3 * SUB_STEP]: "tennis",
  [CATEGORY_BASE + 4 * SUB_STEP]: "cricket",
  [CATEGORY_BASE + 5 * SUB_STEP]: "racing",
};

/** Decode a category code into its market style. Returns null for unknown codes. */
export function parseMarketStyle(category: number): MarketStyle | null {
  if (!Number.isInteger(category) || category < CATEGORY_BASE) return null;
  const sub = Math.floor(category / SUB_STEP) * SUB_STEP;
  const format = category - sub;
  if (format !== 0 && format !== 1 && format !== 2) return null;
  const cat = Math.floor(category / (SUB_STEP * 1_000)) * (SUB_STEP * 1_000);
  return {
    category,
    cat,
    sub,
    format: format as 0 | 1 | 2,
    style: format === 2 ? "multi" : "binary",
    base: BASE_LABELS[cat] ?? `cat:${cat}`,
    subLabel: SUB_LABELS[sub] ?? `sub:${sub}`,
  };
}

/** The oracle metadata for `openWindow` — the question the category dictates. */
export function windowMetadata(handleLabel: string, style: MarketStyle, level: number): string {
  const question = style.style === "binary"
    ? `Will @${handleLabel} aura rise above ${toDisplay(level)}?`
    : `Who will gain the highest aura from window start to end?`;
  return JSON.stringify({
    question,
    style: style.style,
    category: style.category,
    base: style.base,
    sub: style.subLabel,
    handle: handleLabel,
  });
}

/** Display the 1e2 aura level as "30.40". */
export function toDisplay(aura1e2: number): string {
  return (aura1e2 / 100).toFixed(2);
}

/** Aura gained between two 1e2 levels — absolute (close − open), not a %. */
export function gainBetween(open: number, close: number): number {
  return close - open;
}