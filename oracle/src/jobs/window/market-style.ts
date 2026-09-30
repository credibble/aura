/**
 * The market style of a window.
 *
 * Every window is a binary YES/NO on the handle's own aura ("will @x aura rise
 * above L?"). The old `{cat}_{sub}_{format}` taxonomy is gone: a category is now
 * a plain small integer (1 people · 2 crypto · 3 sports · 4 ai · 5 tech ·
 * 6 brands · 7 music · 8 memes · 9 culture) that the UI maps to a family — the
 * oracle only carries it through into the window metadata for display.
 */

export type MarketStyleName = "binary";

export interface MarketStyle {
  /** The handle's primary category code, carried through for display. */
  category: number;
  style: MarketStyleName;
}

/** The style for a handle's primary category code. Unknown codes → 0. */
export function marketStyle(category: number): MarketStyle {
  return {
    category: Number.isInteger(category) && category > 0 ? category : 0,
    style: "binary",
  };
}

/** The oracle metadata for `openWindow` — the question, and the strike the odds
 *  were priced from (1e2), so the index can carry a real number for the chart's
 *  strike line instead of parsing it out of the question text. */
export function windowMetadata(handleLabel: string, style: MarketStyle, level: number): string {
  return JSON.stringify({
    question: `Will @${handleLabel} aura rise above ${toDisplay(level)}?`,
    style: style.style,
    category: style.category,
    handle: handleLabel,
    strike: level,
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
