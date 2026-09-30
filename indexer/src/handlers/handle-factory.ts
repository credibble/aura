/**
 * HandleFactory.HandleCreated — the event carries the handle's whole creation
 * snapshot (the factory has every value in hand), so the row is written from the
 * log alone: owner, wiring, profile and categories in one shot, no `eth_call`.
 *
 * The same event registers the new Handle + Stake contracts, so their own events
 * are indexed from the block they were created in.
 */
import { indexer } from "envio";
import { ZERO_ADDRESS, loadOrCreateHandle, loadOrCreateUser, loadStats } from "../lib/helpers";

/** Both contracts the factory deploys with every handle. */
indexer.contractRegister({ contract: "HandleFactory", event: "HandleCreated" }, ({ event, context }) => {
  context.chain.Handle.add(event.params.handle);
  context.chain.Stake.add(event.params.stake);
});

indexer.onEvent({ contract: "HandleFactory", event: "HandleCreated" }, async ({ event, context }) => {
  const handleId = event.params.handleId.toLowerCase();
  const contract = event.params.handle.toLowerCase();
  const handle = await loadOrCreateHandle(context, handleId, true);

  const owner = await loadOrCreateUser(context, event.params.creator);
  context.User.set({ ...owner, handleCount: owner.handleCount + 1 });

  const stake = event.params.stake.toLowerCase();

  context.Handle.set({
    ...handle,
    contract,
    owner_id: owner.id,
    name: event.params.name,
    symbol: event.params.symbol,
    metadata: event.params.metadata,
    market: event.params.market.toLowerCase(),
    oracleFactory: event.params.oracleFactory.toLowerCase(),
    revenue: event.params.revenue.toLowerCase(),
    stake,
    graduated: false,
    categories: [...event.params.categories],
    verified: false,
    // Two-step ownership (OZ Ownable2Step): the factory's owner is current.
    pendingOwner: ZERO_ADDRESS,
    sources: [],
    windowMinutes: event.params.windowMinutes,
    active: true,
  });

  // Materialize the per-handle Stake receipt; its events are tracked above.
  const known = await context.Stake.get(stake);
  if (!known) {
    context.Stake.set({
      id: stake,
      contract: stake,
      handle_id: handle.id,
      totalSupply: 0n,
      totalAssets: 0n,
      valuePerToken: 10n ** 18n,
    });
  }

  // Track the Handle contract so its event-driven updates resolve to this id.
  context.HandleAddress.set({ id: contract, handleId });

  const stats = await loadStats(context);
  context.Stats.set({ ...stats, handleCount: stats.handleCount + 1 });
});
