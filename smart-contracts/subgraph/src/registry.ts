import { HandleRegistered } from "../generated/MarketRegistry/MarketRegistry";
import { loadOrCreateHandleInactive } from "./helpers";

/**
 * `MarketRegistry.HandleRegistered` fires BEFORE the handle contract exists (the
 * seed/deploy registers the market, then `HandleFactory.createHandle` emits
 * `HandleCreated`). So this only records the window length: the row stays
 * INACTIVE until `HandleCreated` fills in the contract and activates it —
 * otherwise a registered-then-never-created handle (a seed that ran out of gas)
 * shows up in the explore grid with no contract, and the oracle reads `aura()`
 * on the zero address.
 */
export function handleHandleRegistered(event: HandleRegistered): void {
  let handle = loadOrCreateHandleInactive(event.params.handleId);
  handle.windowMinutes = event.params.windowMinutes;
  handle.save();
}