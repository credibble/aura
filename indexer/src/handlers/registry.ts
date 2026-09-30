/**
 * `MarketRegistry.HandleRegistered` fires BEFORE the handle contract exists (the
 * seed/deploy registers the market, then `HandleFactory.createHandle` emits
 * `HandleCreated`). So this only records the window length: the row stays
 * INACTIVE until `HandleCreated` fills in the contract and activates it —
 * otherwise a registered-then-never-created handle shows up in the explore grid
 * with no contract, and the oracle reads `aura()` on the zero address.
 */
import { indexer } from "envio";
import { loadOrCreateHandle } from "../lib/helpers";

indexer.onEvent({ contract: "MarketRegistry", event: "HandleRegistered" }, async ({ event, context }) => {
  const handle = await loadOrCreateHandle(context, event.params.handleId, false);
  context.Handle.set({ ...handle, windowMinutes: event.params.windowMinutes });
});
