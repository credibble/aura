import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  OrderPlaced,
  OrderCancelled,
  OrderUpdated,
  OrderFilled,
} from "../generated/OrderBook/OrderBook";
import { Order, OrderFill } from "../generated/schema";
import {
  eventId,
  loadWindowByOracle,
  loadOrCreateUser,
} from "./helpers";

function loadOrder(id: Bytes): Order | null {
  return Order.load(id.toHexString());
}

export function handleOrderPlaced(event: OrderPlaced): void {
  let win = loadWindowByOracle(event.params.oracle);
  if (win == null) return;
  let maker = loadOrCreateUser(event.params.maker);
  let order = new Order(event.params.id.toHexString());
  order.window = win.id;
  order.maker = maker.id;
  order.outcome = event.params.outcome.toI32();
  order.side = event.params.side;
  order.price = event.params.price;
  order.size = event.params.size;
  order.filled = BigInt.zero();
  order.expiresAt = event.params.expiresAt;
  order.status = "ACTIVE";
  order.createdAt = event.block.timestamp;
  order.save();
}

export function handleOrderCancelled(event: OrderCancelled): void {
  let order = loadOrder(event.params.id);
  if (order == null) return;
  order.status = "CANCELLED";
  order.save();
}

export function handleOrderUpdated(event: OrderUpdated): void {
  let order = loadOrder(event.params.id);
  if (order == null) return;
  order.price = event.params.price;
  order.size = event.params.size;
  order.expiresAt = event.params.expiresAt;
  order.save();
}

export function handleOrderFilled(event: OrderFilled): void {
  let order = loadOrder(event.params.id);
  if (order == null) return;
  let win = loadWindowByOracle(event.params.oracle);
  if (win == null) return;
  let taker = loadOrCreateUser(event.params.taker);

  order.filled = order.filled.plus(event.params.shares);
  if (order.filled.ge(order.size)) order.status = "FILLED";
  order.save();

  let fill = new OrderFill(eventId(event));
  fill.order = order.id;
  fill.window = win.id;
  fill.taker = taker.id;
  fill.outcome = event.params.outcome.toI32();
  fill.shares = event.params.shares;
  fill.price = event.params.price;
  fill.ts = event.block.timestamp;
  fill.save();
}