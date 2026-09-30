/**
 * A Handle contract's own events — the profile, curation and aura updates that
 * arrive AFTER creation.
 *
 * The contract address is resolved back to its handleId through the `HandleAddress`
 * map written by HandleFactory; an untracked Handle contract is ignored.
 */
import { indexer, type Entity } from "envio";
import {
  ZERO_ADDRESS,
  loadOrCreateHandle,
  loadOrCreateUser,
  type Ctx,
} from "../lib/helpers";

/** The handle a Handle-contract event belongs to, or undefined when untracked. */
async function handleFor(
  context: Ctx,
  contract: string,
): Promise<Entity<"Handle"> | undefined> {
  const map = await context.HandleAddress.get(contract);
  if (!map) return undefined;
  return loadOrCreateHandle(context, map.handleId, true);
}

/** Handle.SourcesChanged — the event carries the FULL current `sources[]`. */
indexer.onEvent({ contract: "Handle", event: "SourcesChanged" }, async ({ event, context }) => {
  const handle = await handleFor(context, event.srcAddress);
  if (!handle) return;
  context.Handle.set({ ...handle, sources: [...event.params.sources] });
});

/** Handle.AuraUpdated — the live Aura push (1e2) + the AI's one-line summary. */
indexer.onEvent({ contract: "Handle", event: "AuraUpdated" }, async ({ event, context }) => {
  const map = await context.HandleAddress.get(event.srcAddress);
  if (!map) return;
  const handle = await loadOrCreateHandle(context, map.handleId, true);
  const delta = event.params.aura - handle.aura;

  context.Handle.set({ ...handle, aura: event.params.aura, auraDelta: delta });

  context.AuraHistory.set({
    id: `${handle.id}-${event.block.number}-${event.logIndex}`,
    handle_id: handle.id,
    aura: event.params.aura,
    delta,
    summary: event.params.summary,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
  });
});

/** Handle.CategoriesSet — the backend set the handle's category codes. */
indexer.onEvent({ contract: "Handle", event: "CategoriesSet" }, async ({ event, context }) => {
  const handle = await handleFor(context, event.srcAddress);
  if (!handle) return;
  context.Handle.set({ ...handle, categories: [...event.params.categories] });
});

/** Handle.GraduatedSet — only graduated handles can open windows. */
indexer.onEvent({ contract: "Handle", event: "GraduatedSet" }, async ({ event, context }) => {
  const handle = await handleFor(context, event.srcAddress);
  if (!handle) return;
  context.Handle.set({ ...handle, graduated: event.params.graduated });
});

/** Handle.VerifiedSet — the backend granted/revoked verification. */
indexer.onEvent({ contract: "Handle", event: "VerifiedSet" }, async ({ event, context }) => {
  const handle = await handleFor(context, event.srcAddress);
  if (!handle) return;
  context.Handle.set({ ...handle, verified: event.params.verified });
});

/** Handle.MetadataSet — the profile JSON (name, symbol, photo, imageFit). */
indexer.onEvent({ contract: "Handle", event: "MetadataSet" }, async ({ event, context }) => {
  const handle = await handleFor(context, event.srcAddress);
  if (!handle) return;
  context.Handle.set({ ...handle, metadata: event.params.metadata });
});

/** Handle.WindowMinutesSet — the handle's window length (labels + sorting). */
indexer.onEvent({ contract: "Handle", event: "WindowMinutesSet" }, async ({ event, context }) => {
  const handle = await handleFor(context, event.srcAddress);
  if (!handle) return;
  context.Handle.set({ ...handle, windowMinutes: event.params.windowMinutes });
});

/** Handle.OwnershipTransferStarted (OZ Ownable2Step) — record the pending owner. */
indexer.onEvent(
  { contract: "Handle", event: "OwnershipTransferStarted" },
  async ({ event, context }) => {
    const handle = await handleFor(context, event.srcAddress);
    if (!handle) return;
    context.Handle.set({ ...handle, pendingOwner: event.params.newOwner });
  },
);

/**
 * Handle.OwnershipTransferred (OZ Ownable2Step) — the Handle now belongs to the
 * new owner: re-point the owner relation (handleCount moves with it) and clear
 * the pending owner.
 */
indexer.onEvent({ contract: "Handle", event: "OwnershipTransferred" }, async ({ event, context }) => {
  const handle = await handleFor(context, event.srcAddress);
  if (!handle) return;

  const oldOwner = await loadOrCreateUser(context, event.params.previousOwner);
  const newOwner = await loadOrCreateUser(context, event.params.newOwner);
  if (oldOwner.id !== handle.owner_id) {
    context.User.set({ ...oldOwner, handleCount: oldOwner.handleCount - 1 });
  }
  context.User.set({ ...newOwner, handleCount: newOwner.handleCount + 1 });
  context.Handle.set({ ...handle, owner_id: newOwner.id, pendingOwner: ZERO_ADDRESS });
});
