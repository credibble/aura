/**
 * OrderBook — resting limit orders and their fills. Orders are keyed by the
 * on-chain order id; a window's book is rebuilt from `Order` + `OrderFill`.
 */
import { indexer } from "envio";
import { eventId, loadOrCreateUser, loadWindowByOracle } from "../lib/helpers";

indexer.onEvent({ contract: "OrderBook", event: "OrderPlaced" }, async ({ event, context }) => {
  const win = await loadWindowByOracle(context, event.params.oracle);
  if (!win) return;
  const maker = await loadOrCreateUser(context, event.params.maker);
  context.Order.set({
    id: event.params.id.toLowerCase(),
    window_id: win.id,
    maker_id: maker.id,
    outcome: Number(event.params.outcome),
    side: event.params.side,
    price: event.params.price,
    size: event.params.size,
    filled: 0n,
    expiresAt: event.params.expiresAt,
    status: "ACTIVE",
    createdAt: BigInt(event.block.timestamp),
  });
});

indexer.onEvent({ contract: "OrderBook", event: "OrderCancelled" }, async ({ event, context }) => {
  const order = await context.Order.get(event.params.id.toLowerCase());
  if (!order) return;
  context.Order.set({ ...order, status: "CANCELLED" });
});

indexer.onEvent({ contract: "OrderBook", event: "OrderUpdated" }, async ({ event, context }) => {
  const order = await context.Order.get(event.params.id.toLowerCase());
  if (!order) return;
  context.Order.set({
    ...order,
    price: event.params.price,
    size: event.params.size,
    expiresAt: event.params.expiresAt,
  });
});

indexer.onEvent({ contract: "OrderBook", event: "OrderFilled" }, async ({ event, context }) => {
  const order = await context.Order.get(event.params.id.toLowerCase());
  if (!order) return;
  const win = await loadWindowByOracle(context, event.params.oracle);
  if (!win) return;
  const taker = await loadOrCreateUser(context, event.params.taker);

  const filled = order.filled + event.params.shares;
  context.Order.set({ ...order, filled, status: filled >= order.size ? "FILLED" : order.status });

  context.OrderFill.set({
    id: eventId(event),
    order_id: order.id,
    window_id: win.id,
    taker_id: taker.id,
    outcome: Number(event.params.outcome),
    shares: event.params.shares,
    price: event.params.price,
    ts: BigInt(event.block.timestamp),
  });
});
