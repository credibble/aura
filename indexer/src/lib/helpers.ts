/**
 * Shared bookkeeping: entity ids, load-or-create helpers for the entities every
 * handler touches, and the fixed-point maths the LMSR seeding needs.
 *
 * Envio's `set` writes a whole row, so the load-or-create helpers return the row
 * to spread, and never mutate a loaded object in place: preload optimisation runs
 * every handler twice, and an in-place mutation would apply twice.
 *
 * Everything here comes from events — no `eth_call`, no archive RPC.
 */
import type { Entity, EvmOnEventContext } from "envio";

/** The handler context, as generated for this project's config. */
export type Ctx = EvmOnEventContext;

export const ONE = 10n ** 18n;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Stable window key — `${handleId}-${windowStart}`. */
export function windowId(handleId: string, windowStart: bigint): string {
  return `${handleId}-${windowStart}`;
}

/** `${txHash}-${logIndex}` — one event, one row. */
export function eventId(event: { transaction: { hash: string }; logIndex: number }): string {
  return `${event.transaction.hash}-${event.logIndex}`;
}

/** An account — one entity per address. Owns handles AND trades. */
export async function loadOrCreateUser(context: Ctx, account: string): Promise<Entity<"User">> {
  const id = account.toLowerCase();
  const existing = await context.User.get(id);
  if (existing) return existing;
  const user: Entity<"User"> = { id, handleCount: 0, totalPremium: 0n, totalProceeds: 0n };
  context.User.set(user);
  return user;
}

/**
 * A handle row with every field at its default. A handle that has to be
 * FABRICATED (its HandleCreated was before the indexer's start block) is created
 * inactive, so a market event can never conjure a phantom handle into the
 * explore grid.
 */
export async function loadOrCreateHandle(
  context: Ctx,
  handleId: string,
  active: boolean,
): Promise<Entity<"Handle">> {
  const id = handleId.toLowerCase();
  const existing = await context.Handle.get(id);
  if (existing) return existing;
  const owner = await loadOrCreateUser(context, ZERO_ADDRESS);
  const handle: Entity<"Handle"> = {
    id,
    contract: ZERO_ADDRESS,
    owner_id: owner.id,
    name: null,
    symbol: null,
    metadata: null,
    market: ZERO_ADDRESS,
    oracleFactory: ZERO_ADDRESS,
    revenue: ZERO_ADDRESS,
    stake: ZERO_ADDRESS,
    sources: [],
    aura: 0n,
    auraDelta: 0n,
    graduated: false,
    categories: [],
    verified: false,
    pendingOwner: ZERO_ADDRESS,
    windowMinutes: 0n,
    active,
    windowCount: 0,
  };
  context.Handle.set(handle);
  return handle;
}

/** A window before any of its fields are known. */
export function blankWindow(
  id: string,
  handleId: string,
  windowStart: bigint,
  handleRowId: string,
): Entity<"Window"> {
  return {
    id,
    handle_id: handleRowId,
    oracle: ZERO_ADDRESS,
    oracleMetadata: "",
    question: "",
    style: "",
    handleId,
    windowStart,
    windowEnd: 0n,
    strike: 0n,
    outcomes: [],
    initialProbabilities: [],
    prices: [],
    liquidity: 0n,
    q: [],
    timestamp: 0n,
    cash: 0n,
    settled: false,
    winningOutcome: null,
    reserved: 0n,
    paidOut: 0n,
    volume: 0n,
  };
}

/**
 * Resolve the Window for an oracle address (MarketMaker/Pool events log the
 * oracle only). Undefined when the window was never indexed — such events are
 * dropped rather than mis-attributed.
 */
export async function loadWindowByOracle(
  context: Ctx,
  oracle: string,
): Promise<Entity<"Window"> | undefined> {
  const index = await context.OracleWindow.get(oracle.toLowerCase());
  if (!index) return undefined;
  return context.Window.get(index.window_id);
}

/** Protocol-wide counters (single "stats" row). */
export async function loadStats(context: Ctx): Promise<Entity<"Stats">> {
  const existing = await context.Stats.get("stats");
  if (existing) return existing;
  return {
    id: "stats",
    handleCount: 0,
    windowCount: 0,
    openWindows: 0,
    totalVolume: 0n,
    totalCash: 0n,
  };
}

/** The level in a question ("Will @x aura rise above 35.50?") as 1e2. */
function strikeFromQuestion(question: string): bigint {
  const match = question.match(/above\s+([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) return 0n;
  const level = Number(match[1]);
  return Number.isFinite(level) ? BigInt(Math.round(level * 100)) : 0n;
}

/** Parse the Oracle's metadata JSON into the indexed display fields. */
export function parseOracleMetadata(raw: string): {
  question: string;
  style: string;
  strike: bigint;
} {
  if (!raw) return { question: "", style: "", strike: 0n };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { question: "", style: "", strike: 0n };
    }
    const obj = parsed as Record<string, unknown>;
    const question = typeof obj.question === "string" ? obj.question : "";
    // The strike the odds were priced from, 1e2 — a real number, so the app draws
    // its strike line without parsing the question text. Metadata written before
    // that field existed carries the level only in the question, so fall back to
    // reading it from there rather than reporting a zero strike.
    return {
      question,
      style: typeof obj.style === "string" ? obj.style : "",
      strike:
        typeof obj.strike === "number" && Number.isFinite(obj.strike)
          ? BigInt(Math.round(obj.strike))
          : strikeFromQuestion(question),
    };
  } catch {
    return { question: "", style: "", strike: 0n };
  }
}

/**
 * ln(x) for x ≥ 1 in 1e18 fixed point — the integer twin of the contracts'
 * MathLib.ln. Used only to seed the LMSR bookkeeping vector (`q`).
 */
export function lnFixed(x: bigint): bigint {
  if (x <= ONE) return 0n;
  // ln(x) = 2·atanh((x−1)/(x+1)) expanded — converges fast for the ratios used.
  const z = ((x - ONE) * ONE) / (x + ONE);
  const z2 = (z * z) / ONE;
  let term = z;
  let sum = term;
  for (let k = 1; k < 12; k++) {
    term = (term * z2) / ONE;
    sum += term / BigInt(2 * k + 1);
  }
  return sum * 2n;
}

/** ln(n) for a small integer n, in 1e18. */
export function lnFixedN(n: number): bigint {
  return lnFixed(BigInt(n) * ONE);
}

/** Floor a possibly-negative bigint at zero (guards hand-rolled ledgers). */
export function floor0(value: bigint): bigint {
  return value < 0n ? 0n : value;
}
