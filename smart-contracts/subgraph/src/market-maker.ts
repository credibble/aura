import { BigInt, Address, ethereum } from "@graphprotocol/graph-ts";
import {
  WindowOpened,
  Bought,
  Sold,
  Settled,
  Claimed,
  Transferred,
  MarketMaker as MarketMakerContract,
} from "../generated/MarketMaker/MarketMaker";
import { Oracle as OracleContract } from "../generated/OracleFactory/Oracle";
import { Window, Trade, OracleWindow, PricePoint, ShareTransfer } from "../generated/schema";
import {
  ONE,
  applyOracleMetadata,
  eventId,
  lnFixed,
  lnFixedBig,
  loadOrCreateHandleInactive,
  loadOrCreateUser,
  loadStats,
  loadWindowByOracle,
  recomputePrices,
  windowId,
} from "./helpers";

/** Snapshot the window's full price vector at this event (real chart source). */
function recordPricePoint(win: Window, event: ethereum.Event): void {
  let point = new PricePoint(eventId(event));
  point.window = win.id;
  point.ts = event.block.timestamp;
  point.prices = win.prices;
  point.save();
}

/**
 * Read the window's live prices straight from the MarketMaker (`priceOf`) — the
 * on-chain LMSR, so the chart can never disagree with what traders pay. Falls
 * back to the derived vector only if the call reverts (window not yet indexed).
 */
function syncPrices(
  win: Window,
  marketAddress: Address,
  oracle: Address,
  outcomeCount: i32,
): void {
  let market = MarketMakerContract.bind(marketAddress);
  let prices = new Array<BigInt>(outcomeCount);
  let ok = true;
  for (let i = 0; i < outcomeCount; i++) {
    let p = market.try_priceOf(oracle, BigInt.fromI32(i));
    if (p.reverted) {
      ok = false;
      break;
    }
    prices[i] = p.value;
  }
  if (ok) {
    win.prices = prices;
  } else {
    recomputePrices(win);
  }
}

export function handleWindowOpened(event: WindowOpened): void {
  let handle = loadOrCreateHandleInactive(event.params.handleId);
  let id = windowId(event.params.handleId, event.params.windowStart);

  let win = Window.load(id);
  let isNew = win == null;
  if (win == null) {
    win = new Window(id);
    win.handle = handle.id;
    win.handleId = event.params.handleId;
    win.windowStart = event.params.windowStart;
    win.windowEnd = BigInt.zero();
    win.outcomes = [];
    win.question = "";
    win.style = "";
    win.initialProbabilities = [];
    win.prices = [];
    win.liquidity = BigInt.zero();
    win.q = [];
    win.reference = BigInt.zero();
    win.timestamp = BigInt.zero();
    win.cash = BigInt.zero();
    win.settled = false;
    win.reserved = BigInt.zero();
    win.paidOut = BigInt.zero();
    win.volume = BigInt.zero();
  }

  // Metadata is normally indexed by handleOracleDeployed (same tx, earlier
  // log); read it here too when that handler hasn't populated it.
  if (win.oracleMetadata.length == 0) {
    let meta = OracleContract.bind(event.params.oracle).try_metadata();
    if (!meta.reverted) {
      win.oracleMetadata = meta.value;
      applyOracleMetadata(win);
    }
  }

  win.handle = handle.id;
  win.oracle = event.params.oracle;
  win.handleId = event.params.handleId;
  win.windowStart = event.params.windowStart;
  win.windowEnd = event.params.windowEnd;
  win.outcomes = event.params.outcomes;
  win.initialProbabilities = event.params.probabilities;
  win.timestamp = event.params.windowStart;
  win.cash = event.params.funding;
  win.settled = false;

  // Seed the LMSR state EXACTLY like MarketMaker.openWindow, without floats:
  //   b = funding / ln(n);  q_i = b · ln(p_i / p_min)  (p_i = 0 → q_i = 0)
  let n = event.params.outcomes.length;
  let probs = event.params.probabilities;
  let pMin = BigInt.zero();
  for (let i = 0; i < n; i++) {
    let p = probs[i];
    if (p.gt(BigInt.zero()) && (pMin.le(BigInt.zero()) || p.lt(pMin))) {
      pMin = p;
    }
  }
  let lnScaled = lnFixed(n);
  let b = event.params.funding.times(ONE).div(lnScaled);
  let q = new Array<BigInt>(n);
  for (let i = 0; i < n; i++) {
    if (probs[i].gt(BigInt.zero()) && pMin.gt(BigInt.zero())) {
      // ln(p_i / p_min) = ln(p_i) - ln(p_min), both fixed-point.
      let lr = lnFixedBig(probs[i].times(ONE).div(pMin));
      q[i] = b.times(lr).div(ONE);
    } else {
      q[i] = BigInt.zero();
    }
  }
  win.liquidity = b;
  win.q = q;
  // Prices come from the CONTRACT, not from re-deriving the LMSR off-chain: the
  // chart must show the same numbers traders see, and float math drifts.
  syncPrices(win, event.address, event.params.oracle, n);
  win.save();

  if (isNew) {
    handle.windowCount += 1;
    handle.save();
  }

  let byOracle = new OracleWindow(event.params.oracle.toHexString());
  byOracle.window = id;
  byOracle.save();

  let stats = loadStats();
  stats.windowCount += 1;
  stats.openWindows += 1;
  stats.totalCash = stats.totalCash.plus(event.params.funding);
  stats.save();
}

export function handleBought(event: Bought): void {
  let win = loadWindowByOracle(event.params.oracle);
  if (win == null) return;
  let user = loadOrCreateUser(event.params.trader);
  let trade = new Trade(eventId(event));
  trade.window = win.id;
  trade.user = user.id;
  trade.outcome = event.params.outcome.toI32();
  trade.kind = "BUY";
  trade.premium = event.params.amountIn;
  trade.proceeds = BigInt.zero();
  trade.shares = event.params.sharesMinted;
  trade.price = event.params.price;
  trade.ts = event.block.timestamp;
  trade.save();

  // Net collateral kept by the window = amountIn − fee. The contract mints
  // shares = net / price, so net round-trips from the event to <2 wei.
  let net = event.params.sharesMinted.times(event.params.price).div(ONE);

  win.volume = win.volume.plus(event.params.amountIn);
  win.cash = win.cash.plus(event.params.amountIn.minus(net));
  let o = event.params.outcome.toI32();
  win.q[o] = win.q[o].plus(event.params.sharesMinted);
  syncPrices(win, event.address, event.params.oracle, win.outcomes.length);
  win.save();
  recordPricePoint(win, event);

  user.totalPremium = user.totalPremium.plus(event.params.amountIn);
  user.save();

  let stats = loadStats();
  stats.totalVolume = stats.totalVolume.plus(event.params.amountIn);
  stats.totalCash = stats.totalCash.plus(event.params.amountIn.minus(net));
  stats.save();
}

export function handleSold(event: Sold): void {
  let win = loadWindowByOracle(event.params.oracle);
  if (win == null) return;
  let user = loadOrCreateUser(event.params.trader);
  let trade = new Trade(eventId(event));
  trade.window = win.id;
  trade.user = user.id;
  trade.outcome = event.params.outcome.toI32();
  trade.kind = "SELL";
  trade.premium = BigInt.zero();
  trade.proceeds = event.params.proceeds;
  trade.shares = event.params.sharesBurned;
  trade.price = event.params.sharesBurned.gt(BigInt.zero())
    ? event.params.proceeds.times(ONE).div(event.params.sharesBurned)
    : BigInt.zero();
  trade.ts = event.block.timestamp;
  trade.save();

  win.cash = win.cash.minus(event.params.proceeds);
  let o = event.params.outcome.toI32();
  let shares = event.params.sharesBurned;
  if (win.q[o].gt(shares)) {
    win.q[o] = win.q[o].minus(shares);
  } else {
    win.q[o] = BigInt.zero();
  }
  syncPrices(win, event.address, event.params.oracle, win.outcomes.length);
  win.save();
  recordPricePoint(win, event);

  user.totalProceeds = user.totalProceeds.plus(event.params.proceeds);
  user.save();

  let stats = loadStats();
  stats.totalCash = stats.totalCash.gt(event.params.proceeds)
    ? stats.totalCash.minus(event.params.proceeds)
    : BigInt.zero();
  stats.save();
}

/**
 * Outcome-share transfers. Fills on the order book move shares through
 * `MarketMaker.transferFrom`, which only emits this event — without indexing it,
 * anyone who traded a limit order would appear to hold the wrong position.
 *
 * Two `Trade` rows record the movement (out for the sender, in for the receiver)
 * so position math that sums trades stays correct, plus a `ShareTransfer` row as
 * the audit trail.
 */
export function handleTransferred(event: Transferred): void {
  let win = loadWindowByOracle(event.params.oracle);
  let from = loadOrCreateUser(event.params.from);
  let to = loadOrCreateUser(event.params.to);
  let outcome = event.params.outcome.toI32();

  if (win != null) {
    let xfer = new ShareTransfer(eventId(event));
    xfer.window = win.id;
    xfer.from = from.id;
    xfer.to = to.id;
    xfer.outcome = outcome;
    xfer.amount = event.params.amount;
    xfer.ts = event.block.timestamp;
    xfer.save();

    let outRow = new Trade(eventId(event) + "-out");
    outRow.window = win.id;
    outRow.user = from.id;
    outRow.outcome = outcome;
    outRow.kind = "TRANSFER_OUT";
    outRow.premium = BigInt.zero();
    outRow.proceeds = BigInt.zero();
    outRow.shares = event.params.amount;
    outRow.price = BigInt.zero();
    outRow.ts = event.block.timestamp;
    outRow.save();

    let inRow = new Trade(eventId(event) + "-in");
    inRow.window = win.id;
    inRow.user = to.id;
    inRow.outcome = outcome;
    inRow.kind = "TRANSFER_IN";
    inRow.premium = BigInt.zero();
    inRow.proceeds = BigInt.zero();
    inRow.shares = event.params.amount;
    inRow.price = BigInt.zero();
    inRow.ts = event.block.timestamp;
    inRow.save();
  }
}

export function handleSettled(event: Settled): void {
  let win = loadWindowByOracle(event.params.oracle);
  if (win == null) return;
  win.settled = true;
  win.winningOutcome = event.params.winningOutcome.toI32();
  win.save();

  // Locked cash leaves TVL at settlement; later claims only drain the
  // (already-excluded) window balance. Guarded: a `Settled` without a matching
  // `Opened` (or a double count) must not underflow and drop the event.
  let stats = loadStats();
  if (stats.openWindows > 0) stats.openWindows -= 1;
  stats.totalCash = stats.totalCash.gt(win.cash)
    ? stats.totalCash.minus(win.cash)
    : BigInt.zero();
  stats.save();
}

export function handleClaimed(event: Claimed): void {
  let win = loadWindowByOracle(event.params.oracle);
  if (win == null) return;
  let user = loadOrCreateUser(event.params.trader);
  let trade = new Trade(eventId(event));
  trade.window = win.id;
  trade.user = user.id;
  trade.outcome = event.params.outcome.toI32();
  trade.kind = "CLAIM";
  trade.premium = BigInt.zero();
  trade.proceeds = event.params.payout;
  trade.shares = event.params.sharesBurned;
  trade.price = event.params.sharesBurned.gt(BigInt.zero())
    ? event.params.payout.times(ONE).div(event.params.sharesBurned)
    : BigInt.zero();
  trade.ts = event.block.timestamp;
  trade.save();

  win.cash = win.cash.minus(event.params.payout);
  let o = event.params.outcome.toI32();
  let held = event.params.sharesBurned;
  if (win.q[o].gt(held)) {
    win.q[o] = win.q[o].minus(held);
  } else {
    win.q[o] = BigInt.zero();
  }
  win.save();

  user.totalProceeds = user.totalProceeds.plus(event.params.payout);
  user.save();
}
