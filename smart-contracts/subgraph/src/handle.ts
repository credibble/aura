import {
  AuraUpdated,
  CategorySet,
  GraduatedSet,
  OwnershipTransferred,
  OwnershipTransferStarted,
  SourcesChanged,
  VerifiedSet,
} from "../generated/HandleFactory/Handle";
import { HandleAddress, AuraHistory } from "../generated/schema";
import { loadOrCreateUser, loadOrCreateHandle, categoryIdOf, ZERO_ADDRESS } from "./helpers";

/**
 * Handle.SourcesChanged — the handle's owner added/removed a source config.
 * The event carries the FULL current `sources[]`, so the indexed Handle entity
 * is updated to match without re-reading the chain.
 */
export function handleSourcesChanged(event: SourcesChanged): void {
  let map = HandleAddress.load(event.address.toHexString());
  if (map == null) return; // only Handles created through the factory are tracked
  let handle = loadOrCreateHandle(map.handleId);
  handle.sources = event.params.sources;
  handle.save();
}

/** Handle.AuraUpdated — the protocol pushed the handle's live Aura (1e2).
 *  Records the new level + the AI summary as a historical AuraHistory row. */
export function handleAuraUpdated(event: AuraUpdated): void {
  let map = HandleAddress.load(event.address.toHexString());
  if (map == null) return;
  let handle = loadOrCreateHandle(map.handleId);
  let delta = event.params.aura.minus(handle.aura);
  handle.aura = event.params.aura;
  handle.auraDelta = delta;
  handle.save();

  let hist = new AuraHistory(
    map.handleId.toHexString() +
      "-" +
      event.block.number.toString() +
      "-" +
      event.logIndex.toString(),
  );
  hist.handle = handle.id;
  hist.aura = event.params.aura;
  hist.delta = delta;
  hist.summary = event.params.summary;
  hist.blockNumber = event.block.number;
  hist.timestamp = event.block.timestamp;
  hist.save();
}

/** Handle.CategorySet — the backend set the content category. */
export function handleCategorySet(event: CategorySet): void {
  let map = HandleAddress.load(event.address.toHexString());
  if (map == null) return;
  let handle = loadOrCreateHandle(map.handleId);
  handle.category = event.params.category;
  handle.categoryId = categoryIdOf(event.params.category);
  handle.save();
}

/** Handle.GraduatedSet — the backend granted/revoked trading-prediction
 *  graduation (only graduated handles can open windows). */
export function handleGraduatedSet(event: GraduatedSet): void {
  let map = HandleAddress.load(event.address.toHexString());
  if (map == null) return;
  let handle = loadOrCreateHandle(map.handleId);
  handle.graduated = event.params.graduated;
  handle.save();
}

/** Handle.VerifiedSet — the backend granted/revoked the handle's verification. */
export function handleVerifiedSet(event: VerifiedSet): void {
  let map = HandleAddress.load(event.address.toHexString());
  if (map == null) return;
  let handle = loadOrCreateHandle(map.handleId);
  handle.verified = event.params.verified;
  handle.save();
}

/** Handle.OwnershipTransferStarted (OZ Ownable2Step) — record the pending
 *  owner; ownership completes when the new owner accepts. */
export function handleOwnershipTransferStarted(event: OwnershipTransferStarted): void {
  let map = HandleAddress.load(event.address.toHexString());
  if (map == null) return;
  let handle = loadOrCreateHandle(map.handleId);
  handle.pendingOwner = event.params.newOwner;
  handle.save();
}

/** Handle.OwnershipTransferred (OZ Ownable2Step) — the Handle now belongs to
 *  the new owner: re-point the owner relation (handleCount moves with it) and
 *  clear the pending owner. */
export function handleOwnershipTransferred(event: OwnershipTransferred): void {
  let map = HandleAddress.load(event.address.toHexString());
  if (map == null) return;
  let handle = loadOrCreateHandle(map.handleId);

  let oldOwner = loadOrCreateUser(event.params.previousOwner);
  let newOwner = loadOrCreateUser(event.params.newOwner);
  if (oldOwner.id != handle.owner) oldOwner.handleCount -= 1;
  oldOwner.save();
  newOwner.handleCount += 1;
  newOwner.save();
  handle.owner = newOwner.id;
  handle.pendingOwner = ZERO_ADDRESS;
  handle.save();
}