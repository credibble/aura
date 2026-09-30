/**
 * The singleton auraLP vault: every reservation movement is recorded and the
 * window it belongs to is updated; the vault's own state arrives as
 * `PoolStateChanged`, so TVL comes from the Pool itself (the custodian) rather
 * than a hand-rolled ledger of trade deltas.
 */
import { indexer, type Entity } from "envio";
import { ZERO_ADDRESS, eventId, loadStats, loadWindowByOracle, type Ctx } from "../lib/helpers";

function savePoolEvent(
  context: Ctx,
  event: {
    transaction: { hash: string };
    logIndex: number;
    block: { timestamp: number };
    srcAddress: string;
  },
  oracle: string,
  kind: "RESERVED" | "PAID_OUT" | "UNRESERVED",
  amount: bigint,
  to: string | null,
): void {
  context.PoolEvent.set({
    id: eventId(event),
    pool: event.srcAddress,
    oracle,
    kind,
    amount,
    to: to && to !== ZERO_ADDRESS ? to : null,
    timestamp: BigInt(event.block.timestamp),
  });
}

async function onWindow(
  context: Ctx,
  oracle: string,
  change: (win: Entity<"Window">) => Entity<"Window">,
): Promise<void> {
  const win = await loadWindowByOracle(context, oracle);
  if (win) context.Window.set(change(win));
}

indexer.onEvent({ contract: "Pool", event: "Reserved" }, async ({ event, context }) => {
  const oracle = event.params.oracle.toLowerCase();
  await onWindow(context, oracle, (win) => ({ ...win, reserved: win.reserved + event.params.amount }));
  savePoolEvent(context, event, oracle, "RESERVED", event.params.amount, null);
});

indexer.onEvent({ contract: "Pool", event: "PaidOut" }, async ({ event, context }) => {
  const oracle = event.params.oracle.toLowerCase();
  await onWindow(context, oracle, (win) => ({
    ...win,
    paidOut: win.paidOut + event.params.amount,
    reserved: win.reserved - event.params.amount,
  }));
  savePoolEvent(context, event, oracle, "PAID_OUT", event.params.amount, event.params.to.toLowerCase());
});

indexer.onEvent({ contract: "Pool", event: "Unreserved" }, async ({ event, context }) => {
  const oracle = event.params.oracle.toLowerCase();
  await onWindow(context, oracle, (win) => ({ ...win, reserved: win.reserved - event.params.amount }));
  savePoolEvent(context, event, oracle, "UNRESERVED", event.params.amount, null);
});

/** The vault's state after any movement — the pool chart's source. */
indexer.onEvent({ contract: "Pool", event: "PoolStateChanged" }, async ({ event, context }) => {
  const totalSupply = event.params.totalSupply;
  const totalAssets = event.params.totalAssets;

  context.PoolSnapshot.set({
    id: `${event.srcAddress}-${event.block.number}-${event.logIndex}`,
    pool: event.srcAddress,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    totalReserved: event.params.totalReserved,
    idle: event.params.idle,
    totalSupply,
    totalAssets,
    valuePerToken: totalSupply === 0n ? 10n ** 18n : (totalAssets * 10n ** 18n) / totalSupply,
  });

  const stats = await loadStats(context);
  context.Stats.set({ ...stats, totalCash: totalAssets });
});
