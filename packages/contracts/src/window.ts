import type { Direction } from "./domain";

/**
 * Window lifecycle shared by the oracle (off-chain) and the market contracts
 * (on-chain). A window transitions OPEN -> FROZEN -> RESOLVED | VOIDED. The
 * contract enforces that exactly one terminal state is ever reached per
 * (handleId, windowStart), which is what makes settlement idempotent.
 */
export const WINDOW_STATUSES = ["OPEN", "FROZEN", "RESOLVED", "VOIDED"] as const;
export type WindowStatus = (typeof WINDOW_STATUSES)[number];

export const WINDOW_LENGTHS_MIN = [15, 30, 60, 120, 240, 480, 1440] as const;

/** A window never settles sooner than 45s after it opens (matches the frontend). */
export const MIN_SLOT_MS = 45_000;

export function isTerminal(status: WindowStatus): boolean {
  return status === "RESOLVED" || status === "VOIDED";
}

/**
 * Boundary math for a handle's window clock. Shared with the frontend
 * (`window-slots.ts`) so live and resolved slots agree everywhere.
 */
export function slotBounds(now: number, windowMinutes: number): { start: number; end: number } {
  const ms = windowMinutes * 60_000;
  let end = Math.ceil(now / ms) * ms;
  if (end - now < MIN_SLOT_MS) end += ms;
  return { start: end - ms, end };
}

export function msLeft(end: number, now: number): number {
  return Math.max(0, end - now);
}

export function slotLabel(start: number): string {
  return new Date(start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** A concrete window of a handle, live or already settled. */
export interface WindowSlot {
  /** Boundary timestamp as a string — stable across renders. */
  id: string;
  start: number;
  end: number;
  label: string;
  result: Direction;
}

/**
 * The oracle's internal lifecycle phase. NOTE: this is NOT the on-chain
 * `WindowStatus` — the oracle runs COLLECTING -> FREEZING -> RESOLVING -> RESET
 * and maps onto the shared status at the freeze boundary (FREEZE -> FROZEN).
 */
export const WINDOW_PHASES = ["COLLECTING", "FREEZING", "RESOLVING", "RESET"] as const;
export type WindowPhase = (typeof WINDOW_PHASES)[number];