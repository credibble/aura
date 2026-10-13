/**
 * Which lifecycle state a market window is in, derived only from its end time,
 * its `settled` flag and the current time.
 *
 * The on-chain window and the oracle's settlement sweep are two different
 * clocks. A window past its end is NOT tradable, but it is also not
 * necessarily "settling": the oracle refuses to settle a window that produced
 * no aura observation (it leaves it to VOID and refund at the on-chain grace
 * deadline). The UI has no `void` flag to read — the backend only pushes each
 * window to the chain — so the honest readout is a function of elapsed time:
 *
 *   - "trading"  → still open (`windowEnd > now`).
 *   - "awaiting" → just closed, still inside the settle grace. The oracle
 *                  sweeps every ~3 min with a 3-slot lookback, so a resolution
 *                  may legitimately land in the next few minutes.
 *   - "voiding"  → closed long ago and still unresolved. The oracle had no
 *                  observation to settle against, so this window is headed for
 *                  VOID; traders are refunded at the on-chain grace deadline.
 *   - "settled"  → resolved. Not part of the unresolved lifecycle above, but
 *                  carried so the helper is total and never mislabels a window
 *                  that has already paid out.
 */

/**
 * How long after `windowEnd` we keep saying "Awaiting settlement" before calling
 * the window unreachable. The oracle sweeps every ~3 minutes with a 3-slot
 * lookback (~9 min worst case); 20 minutes is several sweeps of headroom for a
 * missed tick or a slow RPC, yet far shorter than the 3-day on-chain grace, so
 * a genuinely observation-less window stops pretending it is about to settle.
 */
export const WINDOW_SETTLE_GRACE_MS = 20 * 60_000;

export type MarketWindowState = "trading" | "awaiting" | "voiding" | "settled";

/**
 * Classify a window. `now` is passed in (ms since epoch) so the decision is a
 * pure function of its inputs and can be tested at fixed clocks.
 */
export function marketWindowState(
  market: { windowEnd: number; settled: boolean },
  now: number,
): MarketWindowState {
  if (market.settled) return "settled";
  if (market.windowEnd > now) return "trading";
  return now - market.windowEnd > WINDOW_SETTLE_GRACE_MS ? "voiding" : "awaiting";
}

/**
 * Which window a market page should present. The windows arrive newest-first,
 * so the page follows the NEWEST one and treats it as `live` (tradable) only
 * while it is unsettled.
 *
 * The previous rule — `find(w => !w.settled)` — skipped a just-settled CURRENT
 * window in favour of an OLDER unsettled one. A handle whose window resolved
 * early (freeze-on-resolve) then rendered as an ancient "No activity — will
 * void" window instead of its settled result, which made every healthy handle
 * look like it was voiding.
 */
export function selectWindow<T extends { settled: boolean }>(
  windows: T[],
): { newest: T | null; live: T | null } {
  const newest = windows[0] ?? null;
  return { newest, live: newest && !newest.settled ? newest : null };
}
