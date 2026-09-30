/**
 * MarketMaker — the trading lifecycle of every window: open, price updates, buy,
 * sell, share transfers, settle, claim.
 *
 * Prices arrive as events (`PricesUpdated`), never as contract reads, so this is
 * a pure log consumer and the chart shows exactly what traders pay.
 */
import { indexer, type Entity } from "envio";
import {
  ONE,
  blankWindow,
  eventId,
  floor0,
  lnFixed,
  lnFixedN,
  loadOrCreateHandle,
  loadOrCreateUser,
  loadStats,
  loadWindowByOracle,
  parseOracleMetadata,
  windowId,
} from "../lib/helpers";

indexer.onEvent({ contract: "MarketMaker", event: "WindowOpened" }, async ({ event, context }) => {
  const handleId = event.params.handleId.toLowerCase();
  const oracle = event.params.oracle.toLowerCase();
  const handle = await loadOrCreateHandle(context, handleId, false);
  const id = windowId(handleId, event.params.windowStart);

  const existing = await context.Window.get(id);
  const isNew = existing === undefined;
  const win = existing ?? blankWindow(id, handleId, event.params.windowStart, handle.id);

  const oracleMetadata = event.params.oracleMetadata;
  const parsed = parseOracleMetadata(oracleMetadata);

  // Seed the LMSR bookkeeping EXACTLY like MarketMaker.openWindow, without
  // floats: b = funding / ln(n); q_i = b · ln(p_i / p_min)  (p_i = 0 → q_i = 0)
  const outcomes = event.params.outcomes;
  const probs = event.params.probabilities;
  const n = outcomes.length;
  let pMin = 0n;
  for (const p of probs) {
    if (p > 0n && (pMin <= 0n || p < pMin)) pMin = p;
  }
  const b = (event.params.funding * ONE) / lnFixedN(n);
  const q = probs.map((p) => (p > 0n && pMin > 0n ? (b * lnFixed((p * ONE) / pMin)) / ONE : 0n));

  context.Window.set({
    ...win,
    handle_id: handle.id,
    oracle,
    oracleMetadata,
    question: parsed.question,
    style: parsed.style,
    strike: parsed.strike,
    handleId,
    windowStart: event.params.windowStart,
    windowEnd: event.params.windowEnd,
    outcomes: [...outcomes],
    initialProbabilities: [...probs],
    timestamp: event.params.windowStart,
    cash: event.params.funding,
    settled: false,
    liquidity: b,
    q,
  });

  if (isNew) {
    context.Handle.set({ ...handle, windowCount: handle.windowCount + 1 });
  }
  context.OracleWindow.set({ id: oracle, window_id: id });

  const stats = await loadStats(context);
  context.Stats.set({
    ...stats,
    windowCount: stats.windowCount + 1,
    openWindows: stats.openWindows + 1,
    totalCash: stats.totalCash + event.params.funding,
  });
});

/**
 * The window's live price vector, emitted by the contract after every change
 * (open, buy, sell). Recorded as a PricePoint — the frontend's real price
 * history, one point per state change.
 */
indexer.onEvent({ contract: "MarketMaker", event: "PricesUpdated" }, async ({ event, context }) => {
  const win = await loadWindowByOracle(context, event.params.oracle);
  if (!win) return;
  const prices = [...event.params.prices];

  context.Window.set({ ...win, prices });
  context.PricePoint.set({
    id: eventId(event),
    window_id: win.id,
    ts: BigInt(event.block.timestamp),
    prices,
  });
});

indexer.onEvent({ contract: "MarketMaker", event: "Bought" }, async ({ event, context }) => {
  const win = await loadWindowByOracle(context, event.params.oracle);
  if (!win) return;
  const user = await loadOrCreateUser(context, event.params.trader);
  const outcome = Number(event.params.outcome);

  context.Trade.set({
    id: eventId(event),
    window_id: win.id,
    user_id: user.id,
    outcome,
    kind: "BUY",
    premium: event.params.amountIn,
    proceeds: 0n,
    shares: event.params.sharesMinted,
    price: event.params.price,
    ts: BigInt(event.block.timestamp),
  });

  // Net collateral kept by the window = amountIn − fee. The contract mints
  // shares = net / price, so net round-trips from the event to <2 wei.
  const net = (event.params.sharesMinted * event.params.price) / ONE;
  const q = [...win.q];
  q[outcome] = (q[outcome] ?? 0n) + event.params.sharesMinted;

  context.Window.set({
    ...win,
    volume: win.volume + event.params.amountIn,
    cash: win.cash + (event.params.amountIn - net),
    q,
  });

  context.User.set({ ...user, totalPremium: user.totalPremium + event.params.amountIn });

  const stats = await loadStats(context);
  context.Stats.set({
    ...stats,
    totalVolume: stats.totalVolume + event.params.amountIn,
    totalCash: stats.totalCash + (event.params.amountIn - net),
  });
});

indexer.onEvent({ contract: "MarketMaker", event: "Sold" }, async ({ event, context }) => {
  const win = await loadWindowByOracle(context, event.params.oracle);
  if (!win) return;
  const user = await loadOrCreateUser(context, event.params.trader);
  const outcome = Number(event.params.outcome);
  const shares = event.params.sharesBurned;

  context.Trade.set({
    id: eventId(event),
    window_id: win.id,
    user_id: user.id,
    outcome,
    kind: "SELL",
    premium: 0n,
    proceeds: event.params.proceeds,
    shares,
    price: shares > 0n ? (event.params.proceeds * ONE) / shares : 0n,
    ts: BigInt(event.block.timestamp),
  });

  const q = [...win.q];
  q[outcome] = floor0((q[outcome] ?? 0n) - shares);
  context.Window.set({ ...win, cash: win.cash - event.params.proceeds, q });

  context.User.set({ ...user, totalProceeds: user.totalProceeds + event.params.proceeds });

  const stats = await loadStats(context);
  context.Stats.set({ ...stats, totalCash: floor0(stats.totalCash - event.params.proceeds) });
});

/**
 * Outcome-share transfers. Fills on the order book move shares through
 * `MarketMaker.transferFrom`, which only emits this event — without indexing it,
 * anyone who traded a limit order would appear to hold the wrong position.
 *
 * Two `Trade` rows record the movement (out for the sender, in for the receiver)
 * so position math that sums trades stays correct, plus a `ShareTransfer` row as
 * the audit trail.
 */
indexer.onEvent({ contract: "MarketMaker", event: "Transferred" }, async ({ event, context }) => {
  const win = await loadWindowByOracle(context, event.params.oracle);
  const from = await loadOrCreateUser(context, event.params.from);
  const to = await loadOrCreateUser(context, event.params.to);
  const outcome = Number(event.params.outcome);
  if (!win) return;

  const id = eventId(event);
  const ts = BigInt(event.block.timestamp);

  context.ShareTransfer.set({
    id,
    window_id: win.id,
    from_id: from.id,
    to_id: to.id,
    outcome,
    amount: event.params.amount,
    ts,
  });

  const rows: [string, Entity<"User">, string][] = [
    ["-out", from, "TRANSFER_OUT"],
    ["-in", to, "TRANSFER_IN"],
  ];
  for (const [suffix, user, kind] of rows) {
    context.Trade.set({
      id: `${id}${suffix}`,
      window_id: win.id,
      user_id: user.id,
      outcome,
      kind,
      premium: 0n,
      proceeds: 0n,
      shares: event.params.amount,
      price: 0n,
      ts,
    });
  }
});

indexer.onEvent({ contract: "MarketMaker", event: "Settled" }, async ({ event, context }) => {
  const win = await loadWindowByOracle(context, event.params.oracle);
  if (!win) return;
  context.Window.set({
    ...win,
    settled: true,
    winningOutcome: Number(event.params.winningOutcome),
  });

  // Locked cash leaves TVL at settlement; later claims only drain the
  // (already-excluded) window balance. Guarded: a `Settled` without a matching
  // `Opened` (or a double count) must not underflow and drop the event.
  const stats = await loadStats(context);
  context.Stats.set({
    ...stats,
    openWindows: stats.openWindows > 0 ? stats.openWindows - 1 : 0,
    totalCash: floor0(stats.totalCash - win.cash),
  });
});

indexer.onEvent({ contract: "MarketMaker", event: "Claimed" }, async ({ event, context }) => {
  const win = await loadWindowByOracle(context, event.params.oracle);
  if (!win) return;
  const user = await loadOrCreateUser(context, event.params.trader);
  const outcome = Number(event.params.outcome);
  const shares = event.params.sharesBurned;

  context.Trade.set({
    id: eventId(event),
    window_id: win.id,
    user_id: user.id,
    outcome,
    kind: "CLAIM",
    premium: 0n,
    proceeds: event.params.payout,
    shares,
    price: shares > 0n ? (event.params.payout * ONE) / shares : 0n,
    ts: BigInt(event.block.timestamp),
  });

  const q = [...win.q];
  q[outcome] = floor0((q[outcome] ?? 0n) - shares);
  context.Window.set({ ...win, cash: win.cash - event.params.payout, q });

  context.User.set({ ...user, totalProceeds: user.totalProceeds + event.params.payout });
});

/**
 * A VOIDED window refunds its traders (`redeemVoid`) — the refund belongs in the
 * trade history beside claims, or a voided position disappears from the record
 * with no trace of the money coming back.
 *
 * The event carries the payout but neither the outcome nor the shares burned, so
 * the row records the money (proceeds) and leaves the share columns at zero:
 * the position arithmetic subtracts shares on a non-BUY kind, and inventing a
 * number here would corrupt it. Everything else mirrors `Claimed` — the window's
 * cash leaves, and the trader's proceeds go up.
 */
indexer.onEvent({ contract: "MarketMaker", event: "VoidRedeemed" }, async ({ event, context }) => {
  const win = await loadWindowByOracle(context, event.params.oracle);
  if (!win) return;
  const user = await loadOrCreateUser(context, event.params.trader);

  context.Trade.set({
    id: eventId(event),
    window_id: win.id,
    user_id: user.id,
    outcome: 0,
    kind: "VOID",
    premium: 0n,
    proceeds: event.params.payout,
    shares: 0n,
    price: 0n,
    ts: BigInt(event.block.timestamp),
  });

  context.Window.set({ ...win, cash: floor0(win.cash - event.params.payout) });
  context.User.set({ ...user, totalProceeds: user.totalProceeds + event.params.payout });
});
