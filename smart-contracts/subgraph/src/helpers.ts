import { Address, BigInt, Bytes, ethereum, json, log, JSONValueKind } from "@graphprotocol/graph-ts";
import { Handle, Window, User, OracleWindow, Stats } from "../generated/schema";

export const ONE = BigInt.fromString("1000000000000000000");
export const ZERO_ADDRESS = Address.zero();

/** Stable window key �?" `${handleId}-${windowStart}`. */
export function windowId(handleId: Bytes, windowStart: BigInt): string {
  return handleId.toHexString() + "-" + windowStart.toString();
}

export function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}

/** A user/account (address) — one entity per address. One account may own many
 *  Handles (via Handle.owner) AND trade (via Trade.user). */
export function loadOrCreateUser(address: Address): User {
  let user = User.load(address.toHexString());
  if (user == null) {
    user = new User(address.toHexString());
    user.handleCount = 0;
    user.totalPremium = BigInt.zero();
    user.totalProceeds = BigInt.zero();
    user.save();
  }
  return user;
}

/**
 * Category CODE → the app's family id. Mirrors the frontend's `categoryFromCode`
 * (`cat = floor(code / 1e6) % 1000`): 100 sports · 1 crypto · 2 ai · 3 people ·
 * 4 brands · 5 memes · 6 music · 7 tech · 8 culture. Anything else → culture.
 */
export function categoryIdOf(code: BigInt): string {
  let cat = (code.toI32() / 1000000) % 1000;
  if (cat === 100) return "sports";
  if (cat === 1) return "crypto";
  if (cat === 2) return "ai";
  if (cat === 3) return "people";
  if (cat === 4) return "brands";
  if (cat === 5) return "memes";
  if (cat === 6) return "music";
  if (cat === 7) return "tech";
  return "culture";
}

/**
 * Map a handle's category CODES to family ids, deduped — several codes can share
 * a family (e.g. 100_001_001 and 100_002_001 are both `sports`), and the index
 * only needs each family once.
 */
export function categoryIdsOf(codes: BigInt[]): string[] {
  let ids = new Array<string>();
  for (let i = 0; i < codes.length; i++) {
    let id = categoryIdOf(codes[i]);
    let seen = false;
    for (let j = 0; j < ids.length; j++) {
      if (ids[j] == id) {
        seen = true;
        break;
      }
    }
    if (!seen) ids.push(id);
  }
  return ids;
}

export function loadOrCreateHandle(handleId: Bytes): Handle {
  let handle = Handle.load(handleId.toHexString());
  if (handle == null) {
    handle = newHandle(handleId, true);
  }
  return handle;
}

/**
 * Same, but a handle that has to be FABRICATED (its `HandleCreated` event was
 * never indexed — e.g. before this subgraph's start block) is created
 * `active = false`, so a market event can never conjure a phantom handle into
 * the explore grid / search.
 */
export function loadOrCreateHandleInactive(handleId: Bytes): Handle {
  let handle = Handle.load(handleId.toHexString());
  if (handle == null) {
    handle = newHandle(handleId, false);
  }
  return handle;
}

function newHandle(handleId: Bytes, active: bool): Handle {
  let handle = new Handle(handleId.toHexString());
  handle.owner = loadOrCreateUser(ZERO_ADDRESS).id;
  handle.contract = ZERO_ADDRESS;
  handle.market = ZERO_ADDRESS;
  handle.oracleFactory = ZERO_ADDRESS;
  handle.revenue = ZERO_ADDRESS;
  handle.stake = ZERO_ADDRESS;
  handle.sources = [];
  handle.aura = BigInt.zero();
  handle.auraDelta = BigInt.zero();
  handle.graduated = false;
  handle.categories = [];
  handle.categoryIds = [];
  handle.verified = false;
  handle.pendingOwner = ZERO_ADDRESS;
  handle.windowMinutes = BigInt.zero();
  handle.active = active;
  handle.windowCount = 0;
  handle.save();
  return handle as Handle;
}

/**
 * ln(x) for x ≥ 1 in 1e18 fixed point — the integer twin of the contracts'
 * MathLib.ln. Used only for the LMSR bookkeeping vector (`q`); displayed prices
 * are read from the chain, never derived here.
 */
export function lnFixedInt(x: BigInt): BigInt {
  if (x.le(ONE)) return BigInt.zero();
  // ln(x) = 2·atanh((x−1)/(x+1)) expanded — converges fast for the ratios used.
  let z = x.minus(ONE).times(ONE).div(x.plus(ONE)); // (x−1)/(x+1), 1e18
  let z2 = z.times(z).div(ONE);
  let term = z;
  let sum = term;
  for (let k = 1; k < 12; k++) {
    term = term.times(z2).div(ONE);
    sum = sum.plus(term.div(BigInt.fromI32(2 * k + 1)));
  }
  return sum.times(BigInt.fromI32(2));
}

/** ln(n) for a small integer n, in 1e18. */
export function lnFixed(n: i32): BigInt {
  return lnFixedInt(BigInt.fromI32(n).times(ONE));
}

/** ln(x18) where x18 is already 1e18-scaled. */
export function lnFixedBig(x18: BigInt): BigInt {
  return lnFixedInt(x18);
}

/** Resolve the Window for an oracle address (events log the oracle only).
 *  Returns null when the window was never indexed (e.g. it opened before the
 *  subgraph start block) — such events are dropped rather than mis-attributed. */
export function loadWindowByOracle(oracle: Address): Window | null {
  let idx = OracleWindow.load(oracle.toHexString());
  if (idx == null) {
    log.warning("window not indexed for oracle {}", [oracle.toHexString()]);
    return null;
  }
  return Window.load(idx.window);
}

/** Protocol-wide counters (single "stats" row), created on first touch. */
export function loadStats(): Stats {
  let stats = Stats.load("stats");
  if (stats == null) {
    stats = new Stats("stats");
    stats.handleCount = 0;
    stats.windowCount = 0;
    stats.openWindows = 0;
    stats.totalVolume = BigInt.zero();
    stats.totalCash = BigInt.zero();
    stats.save();
  }
  return stats;
}

/** Parse the Oracle's metadata JSON into the indexed display fields
 *  (`question`, `style`) so the frontend reads GraphQL, not raw JSON. */
export function applyOracleMetadata(win: Window): void {
  if (win.oracleMetadata.length == 0) return;
  let root = json.fromString(win.oracleMetadata);
  if (root.kind != JSONValueKind.OBJECT) return;
  let obj = root.toObject();
  let question = obj.get("question");
  if (question != null && question.kind == JSONValueKind.STRING) {
    win.question = question.toString();
  }
  let style = obj.get("style");
  if (style != null && style.kind == JSONValueKind.STRING) {
    win.style = style.toString();
  }
}

/** f64 -> BigInt (floor). Callers keep magnitudes < 1e18 (saturation guards
 *  the i64 range). NOTE: AssemblyScript's f64.toString() always appends
 *  ".0" ("1.0" -> "1.0"), which graph-node's BigInt.fromString rejects with
 *  "string is not a BigInt" — so never stringify an f64 directly; go via i64. */
export function bigFromF64(x: f64): BigInt {
  if (x > 9.0e18) x = 9.0e18;
  if (x < -9.0e18) x = -9.0e18;
  return BigInt.fromString((Math.floor(x) as i64).toString());
}

/** Recompute `prices` from the LMSR state: p_i = e^(q_i/b) / Σ e^(q_j/b).
 *  Max-shifted softmax keeps f64 exp in range; mirrors MarketMaker.priceOf. */
export function recomputePrices(win: Window): void {
  let n = win.q.length;
  if (n == 0) return;
  let b = parseFloat(win.liquidity.toString());
  if (b <= 0) return;
  let maxE = parseFloat(win.q[0].toString()) / b;
  for (let i = 1; i < n; i++) {
    let e = parseFloat(win.q[i].toString()) / b;
    if (e > maxE) maxE = e;
  }
  let sum: f64 = 0;
  let weights = new Array<f64>(n);
  for (let i = 0; i < n; i++) {
    let w = Math.exp(parseFloat(win.q[i].toString()) / b - maxE);
    weights[i] = w;
    sum += w;
  }
  let prices = new Array<BigInt>(n);
  for (let i = 0; i < n; i++) {
    prices[i] = bigFromF64((weights[i] / sum) * 1e18);
  }
  win.prices = prices;
}