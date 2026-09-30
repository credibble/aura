import type { AuraHandle } from "../jobs.types";

/**
 * Multi-outcome (gain) market construction. A group handle (@football,
 * category 100_001_002) opens a window whose outcomes are underlying handles of
 * the SAME category sub (@arsenal, @manutd, ...): the oracle picks them AT
 * RANDOM, capped at `MAX_OUTCOMES`, prices the open with aura-weighted initial
 * probabilities (the LMSR seeds exactly to them), and settles to the member
 * that gained the most aura (close − open) over the window.
 */

/** Hard cap on a multi window's outcomes. */
export const MAX_OUTCOMES = 12;

/** Weighting floor — no outcome may open below 0.25% (avoids ~0-price rounds). */
const PRIOR_FLOOR = 0.0025;

/** Randomly sample up to `max` member handles of a group's category (excludes
 *  the group handle itself). Deterministic for tests via `rng`. */
export function sampleMembers(
  pool: AuraHandle[],
  groupLabel: string,
  max: number = MAX_OUTCOMES,
  rng: () => number = Math.random,
): AuraHandle[] {
  const group = groupLabel.toLowerCase();
  const candidates = pool.filter((h) => h.label.toLowerCase() !== group);
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, max);
}

/** Aura-weighted initial probabilities (1e18, Σ EXACTLY = 1e18; last absorbs
 *  the rounding remainder). A higher-aura member opens more favored. */
export function priorProbabilities(members: AuraHandle[]): string[] {
  if (members.length === 0) return [];
  const weights = members.map((m) => Math.max(m.aura, 0) + 1e-9);
  const total = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / total) * (1 - PRIOR_FLOOR * members.length) + PRIOR_FLOOR);
  const ONE = 10n ** 18n;
  const probs = raw.map((p) => BigInt(Math.floor(p * Number(ONE))));
  // Absorb any rounding drift into the last outcome so Σ == 1e18 exactly.
  const drift = ONE - probs.reduce((a, b) => a + b, 0n);
  probs[probs.length - 1] = probs[probs.length - 1]! + drift;
  return probs.map((p) => p.toString());
}