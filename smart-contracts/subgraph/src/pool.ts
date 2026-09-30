import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  Reserved,
  PaidOut,
  Unreserved,
  Deposited,
  Withdrawn,
  Pool as PoolContract,
} from "../generated/Pool/Pool";
import { PoolEvent, PoolSnapshot } from "../generated/schema";
import { eventId, loadStats, loadWindowByOracle } from "./helpers";

function savePoolEvent(
  event: ethereum.Event,
  pool: Address,
  oracle: Bytes,
  kind: string,
  amount: BigInt,
  to: Address,
): void {
  let pe = new PoolEvent(eventId(event));
  pe.pool = pool;
  pe.oracle = oracle;
  pe.kind = kind;
  pe.amount = amount;
  if (to !== Address.zero()) pe.to = to;
  pe.timestamp = event.block.timestamp;
  pe.save();
}

/** Historical pool snapshot (charts) — read the vault state at the event block. */
function snapshot(event: ethereum.Event): void {
  let pool = PoolContract.bind(event.address);
  let totalSupply = pool.totalSupply();
  let totalAssets = pool.totalAssets();
  let snap = new PoolSnapshot(
    event.address.toHexString() + "-" + event.block.number.toString() + "-" + event.logIndex.toString(),
  );
  snap.pool = event.address;
  snap.blockNumber = event.block.number;
  snap.timestamp = event.block.timestamp;
  snap.totalReserved = pool.totalReserved();
  snap.idle = pool.idle();
  snap.totalSupply = totalSupply;
  snap.totalAssets = totalAssets;
  snap.valuePerToken = totalSupply.equals(BigInt.zero())
    ? BigInt.fromI32(10).pow(18)
    : totalAssets.times(BigInt.fromI32(10).pow(18)).div(totalSupply);
  snap.save();

  // TVL comes from the VAULT, not from a hand-rolled ledger of trade deltas:
  // the Pool is the custodian, so this is the only number that can't drift.
  let stats = loadStats();
  stats.totalCash = totalAssets;
  stats.save();
}

export function handleDeposited(event: Deposited): void {
  snapshot(event);
}

export function handleWithdrawn(event: Withdrawn): void {
  snapshot(event);
}

/** The auraLP vault reserved capacity for a window (oracle key) — track on the window. */
export function handleReserved(event: Reserved): void {
  let win = loadWindowByOracle(event.params.oracle);
  if (win != null) {
    win.reserved = win.reserved.plus(event.params.amount);
    win.save();
  }
  savePoolEvent(event, event.address, event.params.oracle, "RESERVED", event.params.amount, Address.zero());
  snapshot(event);
}

export function handlePaidOut(event: PaidOut): void {
  let win = loadWindowByOracle(event.params.oracle);
  if (win != null) {
    win.paidOut = win.paidOut.plus(event.params.amount);
    win.reserved = win.reserved.minus(event.params.amount);
    win.save();
  }
  savePoolEvent(event, event.address, event.params.oracle, "PAID_OUT", event.params.amount, event.params.to);
  snapshot(event);
}

export function handleUnreserved(event: Unreserved): void {
  let win = loadWindowByOracle(event.params.oracle);
  if (win != null) {
    win.reserved = win.reserved.minus(event.params.amount);
    win.save();
  }
  savePoolEvent(event, event.address, event.params.oracle, "UNRESERVED", event.params.amount, Address.zero());
  snapshot(event);
}