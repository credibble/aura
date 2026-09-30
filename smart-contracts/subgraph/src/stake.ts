import { BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  Deposited,
  Withdrawn,
  Rewarded,
  Stake as StakeContract,
} from "../generated/templates/Stake/Stake";
import { Stake, StakeSnapshot } from "../generated/schema";

/**
 * Stake (per-handle AURA LP receipt) template: on every deposit/withdraw/
 * reward it updates the live Stake entity (supply, assets, share price) and
 * writes a StakeSnapshot — the historical staking chart for a handle.
 */
function record(event: ethereum.Event): void {
  let stake = Stake.load(event.address.toHexString());
  if (stake == null) return; // only stakes created via HandleCreated are tracked

  let c = StakeContract.bind(event.address);
  let totalSupply = c.totalSupply();
  let totalAssets = c.totalAssets();
  let valuePerToken = c.valuePerToken();

  stake.totalSupply = totalSupply;
  stake.totalAssets = totalAssets;
  stake.valuePerToken = valuePerToken;
  stake.save();

  let snap = new StakeSnapshot(
    event.address.toHexString() + "-" + event.block.number.toString() + "-" + event.logIndex.toString(),
  );
  snap.stake = stake.id;
  snap.blockNumber = event.block.number;
  snap.timestamp = event.block.timestamp;
  snap.totalSupply = totalSupply;
  snap.totalAssets = totalAssets;
  snap.valuePerToken = valuePerToken;
  snap.save();
}

export function handleDeposited(event: Deposited): void {
  record(event);
}

export function handleWithdrawn(event: Withdrawn): void {
  record(event);
}

export function handleRewarded(event: Rewarded): void {
  record(event);
}