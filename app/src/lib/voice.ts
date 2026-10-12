/**
 * Voice — the app's copy rules, kept in one place.
 *
 * Moderate by design. Slang lives in the CHROME — heroes, primary CTAs, empty
 * states, success toasts — and never in the LEDGER: numbers, prices, PnL,
 * deposits/withdrawals/claims/stakes, errors, or legal copy. Two hard caps:
 * never slang a consequence (funds, fees, settlement), and never stack two
 * slang beats on one surface — if a page already has a slogan, that IS the
 * quip.
 *
 * Only RECURRING strings live here, so the flagship action can't drift apart
 * across screens. One-off quips stay inline next to the component that shows
 * them — that is how this repo already keeps copy close to its usage.
 */

/**
 * The create-handle action, worded the same everywhere it appears as a headline
 * or a full-width action (the account page, the handle switcher).
 */
export const START_FARMING = "Start farming aura";

/**
 * The same action when the surrounding sentence already carries the meaning —
 * a button label, not a headline.
 */
export const START_FARMING_SHORT = "Start farming";
