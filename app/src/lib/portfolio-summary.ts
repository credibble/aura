/**
 * Portfolio summary maths — lifted out of the route so the realised/unrealised
 * split is testable without a browser (`scripts/check-portfolio-summary.mjs`).
 *
 * A settled winner still sitting in the open tab is CASH awaiting claim, not
 * open exposure. Summing it with live positions made a realised gain read as
 * unrealised, and divided it by the combined cost basis of every open row
 * instead of the basis that actually produced it.
 */

/** The subset of a derived position the summary needs. */
export type SummaryPosition = {
  /** Human outcome shares. */
  shares: number;
  /** Mark price for the outcome (settled winners are forced to 1). */
  price: number;
  /** USDC spent/received — can be negative after sells. */
  cost: number;
  /** Whether the window has settled. */
  settled: boolean;
  /** Settled winning shares still unclaimed. */
  claimable: number;
};

export type PortfolioSummary = {
  /** Marked value of every held position (live + claimable). */
  equity: number;
  /** Unsettled positions: value − cost. */
  unrealised: number;
  /** `unrealised` over the unsettled cost basis only. */
  unrealisedPct: number;
  /** Settled winners awaiting claim: proceeds − cost. */
  realised: number;
  /** `realised` over the settled cost basis only. */
  realisedPct: number;
  /** Total settle-and-claim cash across every held position. */
  claimable: number;
  /** Positions strictly above their cost — an exactly-flat position is not up. */
  wins: number;
  /** Held positions covered by the summary. */
  openCount: number;
};

export function summarisePositions(positions: SummaryPosition[]): PortfolioSummary {
  // Only UNsettled windows carry unrealised exposure; a settled winner is
  // realised the moment the window resolves, whether or not it has been claimed.
  const open = positions.filter((p) => !p.settled);
  const settled = positions.filter((p) => p.settled);

  const equity = positions.reduce((s, p) => s + p.shares * p.price, 0);

  const openValue = open.reduce((s, p) => s + p.shares * p.price, 0);
  const openBasis = open.reduce((s, p) => s + Math.max(0, p.cost), 0);
  const unrealised = openValue - openBasis;
  // Multiply before dividing: an exact half (188.25%) then rounds up at display
  // time instead of landing on the binary float just below it.
  const unrealisedPct = openBasis > 0 ? (unrealised * 100) / openBasis : 0;

  const settledProceeds = settled.reduce((s, p) => s + p.claimable, 0);
  const settledBasis = settled.reduce((s, p) => s + Math.max(0, p.cost), 0);
  const realised = settledProceeds - settledBasis;
  const realisedPct = settledBasis > 0 ? (realised * 100) / settledBasis : 0;

  const claimable = positions.reduce((s, p) => s + p.claimable, 0);
  const wins = positions.filter((p) => p.cost > 0 && p.shares * p.price > p.cost).length;

  return {
    equity,
    unrealised,
    unrealisedPct,
    realised,
    realisedPct,
    claimable,
    wins,
    openCount: positions.length,
  };
}
