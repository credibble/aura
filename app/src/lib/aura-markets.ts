import { CATEGORY_MAP, type CategoryId, type MetricId } from "./aura-data";
import { artworkOf } from "./handle-metadata";
import { categoryFromCode, windowLabels } from "@/queries/handles";
import type { SubgraphWindow } from "@/queries/markets";

// ----------------------------------------------------------------------------
// One market model for everything — built from REAL subgraph windows.
//
// A market is one window on a handle: the question comes from the oracle's
// metadata, the outcome list and prices from the window itself, and the
// countdown from windowEnd. Two-outcome windows render with the compact
// Yes/No UI; three or more render with the multi-outcome list UI. Same data,
// same pages — only the presentation differs.
// ----------------------------------------------------------------------------

export type MarketOutcome = {
  id: string;
  label: string;
  /** Live price in whole % (LMSR 1e18 → display, sums to 100). */
  pct: number;
  /** Real move since the window opened (price − initial probability, pts). */
  delta: number;
  color: string;
};

export type Market = {
  /** Handle id — every market lives at /market/<handle id>. */
  id: string;
  question: string;
  /** Display handle chip, e.g. `@btc` (from the handle's on-chain symbol). */
  handle: string;
  handleId: string;
  category: CategoryId;
  metric: MetricId;
  /** Window length in minutes — drives labels + ending-soon ordering. */
  windowMinutes: number;
  /** Long window label ("1-hour") for footers and rules copy. */
  deadline: string;
  /** Cumulative volume in USDC. */
  volume: number;
  settled: boolean;
  winningOutcome: number | null;
  /** Window bounds in ms since epoch. */
  windowStart: number;
  windowEnd: number;
  /**
   * The handle's real artwork, parsed from its on-chain metadata JSON. Carried on
   * the market itself so EVERY card (explore, group, search, feed) can show the
   * photo instead of an identicon — the window query selects `handle.metadata`.
   */
  image?: string;
  imageFit?: "cover" | "contain";
  /** Raw handle metadata JSON, kept for call sites that pass it straight on. */
  metadata?: string | null;
  /** Always at least two; exactly two means the compact UI. */
  outcomes: MarketOutcome[];
  /** Raw window — carries the oracle address + LMSR state for trading. */
  window: SubgraphWindow;
};

/** Stable outcome palette — index-based, same color per slot everywhere. */
const OUTCOME_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--up))",
  "hsl(var(--down))",
  "#f59e0b",
  "#3b82f6",
  "#14b8a6",
];

function outcomeColor(i: number): string {
  return OUTCOME_COLORS[i % OUTCOME_COLORS.length]!;
}

/** 1e18 price → whole %, rounded so the row still sums to 100. */
function pcts(prices: string[]): number[] {
  const pct = prices.map((p) => Math.round(Number(p) / 1e16));
  const total = pct.reduce((s, n) => s + n, 0);
  if (pct.length > 0 && total !== 100) {
    let max = 0;
    for (let i = 1; i < pct.length; i++) if (pct[i]! > pct[max]!) max = i;
    pct[max] = Math.max(0, pct[max]! + (100 - total));
  }
  return pct;
}

/** Build the app's market model from one subgraph window (all real data). */
export function toMarket(w: SubgraphWindow): Market {
  const start = Number(w.windowStart) * 1000;
  const end = Number(w.windowEnd) * 1000;
  const minutes = end > start ? Math.round((end - start) / 60_000) : Number(w.handle.windowMinutes);
  const pct = pcts(w.prices);
  const initial = pcts(w.initialProbabilities);
  return {
    id: w.handle.id,
    question: w.question,
    handle: `@${(w.handle.symbol ?? w.handle.name ?? w.handle.id).toLowerCase()}`,
    handleId: w.handle.id,
    category: categoryFromCode(w.handle.category),
    metric: "aura",
    // Real artwork for every avatar that renders this market.
    metadata: w.handle.metadata ?? null,
    ...artworkOf(w.handle.metadata),
    windowMinutes: minutes,
    deadline: windowLabels(minutes).long,
    volume: Number(w.volume) / 1e18,
    settled: w.settled,
    winningOutcome: w.winningOutcome,
    windowStart: start,
    windowEnd: end,
    outcomes: w.outcomes.map((label, i) => ({
      id: String(i),
      label,
      pct: pct[i] ?? 0,
      delta: (pct[i] ?? 0) - (initial[i] ?? 0),
      color: outcomeColor(i),
    })),
    window: w,
  };
}

/**
 * Markets for a window list. With `dedupe` (the /markets grid) each handle
 * shows only its newest window — one card per market, not one per interval.
 */
export function toMarkets(windows: SubgraphWindow[], dedupe = false): Market[] {
  const out: Market[] = [];
  const seen = new Set<string>();
  for (const w of windows) {
    if (dedupe) {
      if (seen.has(w.handle.id)) continue;
      seen.add(w.handle.id);
    }
    out.push(toMarket(w));
  }
  return out;
}

/** True when the compact Yes/No (2-outcome) presentation applies. */
export function isTwoWay(market: Market): boolean {
  return market.outcomes.length <= 2;
}

/** Where a market's detail page lives — every market is served under /market. */
export function marketHref(market: Market): string {
  return `/market/${market.id}`;
}

/** Mean outcome move since open (pts) — the listing's gain/loss sort key. */
export function marketChange(market: Market): number {
  if (market.outcomes.length === 0) return 0;
  return market.outcomes.reduce((s, o) => s + o.delta, 0) / market.outcomes.length;
}

/** Leader outcome — highest live price (the settlement favourite). */
export function leadOutcome(market: Market): MarketOutcome | undefined {
  return market.outcomes.reduce<MarketOutcome | undefined>(
    (best, o) => (!best || o.pct > best.pct ? o : best),
    undefined,
  );
}

export function marketCategoryLabel(category: string): string {
  return CATEGORY_MAP[category as CategoryId]?.label ?? "Markets";
}
