/**
 * RevenueSharing — every fee split is a durable record: the amount a handle's
 * market paid, split between the creator (user), the auraLP vault and the
 * protocol treasury. Enables per-handle revenue history.
 */
import { indexer } from "envio";
import { eventId, loadOrCreateHandle } from "../lib/helpers";

indexer.onEvent({ contract: "RevenueSharing", event: "FeeSplit" }, async ({ event, context }) => {
  const handle = await loadOrCreateHandle(context, event.params.handleId, true);
  context.FeeSplit.set({
    id: eventId(event),
    handle_id: handle.id,
    amount: event.params.amount,
    user: event.params.user,
    lp: event.params.lp,
    protocol: event.params.protocol,
    ts: BigInt(event.block.timestamp),
  });
});
