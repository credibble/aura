import { BigInt } from "@graphprotocol/graph-ts";
import { FeeSplit as FeeSplitEvent } from "../generated/RevenueSharing/RevenueSharing";
import { FeeSplit } from "../generated/schema";
import { eventId, loadOrCreateHandle } from "./helpers";

/**
 * RevenueSharing → every fee split is a durable record: the amount a handle's
 * market paid, split between the creator (user), the auraLP vault and the
 * protocol treasury. Enables per-handle revenue history.
 */
export function handleFeeSplit(event: FeeSplitEvent): void {
  let handle = loadOrCreateHandle(event.params.handleId);
  let split = new FeeSplit(eventId(event));
  split.handle = handle.id;
  split.amount = event.params.amount;
  split.user = event.params.user;
  split.lp = event.params.lp;
  split.protocol = event.params.protocol;
  split.ts = event.block.timestamp;
  split.save();
}