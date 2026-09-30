export type CategoryId =
  | "crypto"
  | "ai"
  | "sports"
  | "people"
  | "brands"
  | "memes"
  | "music"
  | "tech"
  | "culture";

export type Category = {
  id: CategoryId;
  label: string;
  icon: string;
  description: string;
  tint: string;
};

/**
 * What a market measures. Every market asks about the same signal: **aura** —
 * the ± sentiment of an aggregated feed post, which moves the handle's index.
 * The single-value type keeps questions, labels and ids on one wording.
 */
export type MetricId = "aura";

export const METRIC_LABEL: Record<MetricId, string> = { aura: "Aura" };

/** Static catalog entry (seed metadata — live values come from the subgraph). */
export type AssetSeed = {
  id: string;
  symbol: string;
  name: string;
  category: CategoryId;
  color: string;
  /** Real artwork (logo / photo) hot-linked from the open web. */
  image?: string;
  /** "contain" keeps transparent logos fully visible; photos default to cover. */
  imageFit?: "cover" | "contain";
  /** The handle's raw on-chain metadata JSON — where `photo` lives. */
  metadata?: string | null;
  summary: string;
};

/** A handle's live state — mapped straight from the subgraph (no simulation). */
export type LiveAsset = AssetSeed & {
  index: number;
  change: number;
  volume: number;
  history: number[];
  spark: number[];
  /** Window length in minutes — used for sorting and copy. */
  windowMinutes: number;
  /** The signal this asset's market asks about — always the handle's aura. */
  metric: MetricId;
};

export type FeedKind = "shock" | "velocity" | "trend" | "settle" | "new";

export type FeedEvent = {
  id: string;
  assetId: string;
  kind: FeedKind;
  title: string;
  body: string;
  ts: number;
  change: number;
};

export type AuraState = {
  assets: LiveAsset[];
  feed: FeedEvent[];
};

// ----------------------------------------------------------------------------
// Categories
// ----------------------------------------------------------------------------

export const CATEGORIES: Category[] = [
  {
    id: "crypto",
    label: "Crypto",
    icon: "₿",
    description: "Protocols, tokens & narratives",
    tint: "text-amber-500",
  },
  {
    id: "ai",
    label: "AI",
    icon: "✦",
    description: "Models, agents & tooling",
    tint: "text-emerald-500",
  },
  {
    id: "sports",
    label: "Sports",
    icon: "⚽",
    description: "Clubs, athletes & events",
    tint: "text-sky-500",
  },
  {
    id: "people",
    label: "People",
    icon: "★",
    description: "Founders, creators & icons",
    tint: "text-violet-500",
  },
  {
    id: "brands",
    label: "Brands",
    icon: "◎",
    description: "Companies & products",
    tint: "text-rose-500",
  },
  {
    id: "memes",
    label: "Memes",
    icon: "😹",
    description: "Viral internet culture",
    tint: "text-pink-500",
  },
  {
    id: "music",
    label: "Music",
    icon: "♫",
    description: "Artists, songs & tours",
    tint: "text-fuchsia-500",
  },
  {
    id: "tech",
    label: "Tech",
    icon: "⌁",
    description: "Hardware, games & platforms",
    tint: "text-cyan-500",
  },
  {
    id: "culture",
    label: "Culture",
    icon: "✳",
    description: "Film, TV & moments",
    tint: "text-orange-500",
  },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<
  CategoryId,
  Category
>;

// ----------------------------------------------------------------------------
// Handles — every market is a handle: @btc, @messi, @67, @ai, @football
// ----------------------------------------------------------------------------

const CATEGORY_HANDLE: Record<CategoryId, string> = {
  crypto: "crypto",
  ai: "ai",
  sports: "football",
  people: "people",
  brands: "brands",
  memes: "memes",
  music: "music",
  tech: "tech",
  culture: "culture",
};

/** Handle for a 3+-outcome category market — `@ai`, `@football`. */
export function categoryHandle(category: CategoryId): string {
  return `@${CATEGORY_HANDLE[category]}`;
}

export function indexLabel(metric: MetricId): string {
  return `${METRIC_LABEL[metric]} Index`;
}
