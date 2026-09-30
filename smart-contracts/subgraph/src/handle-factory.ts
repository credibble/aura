import { BigInt } from "@graphprotocol/graph-ts";
import { HandleCreated } from "../generated/HandleFactory/HandleFactory";
import { Handle as HandleContract } from "../generated/HandleFactory/Handle";
import { Handle as HandleTemplate, Stake as StakeTemplate } from "../generated/templates";
import { HandleAddress, Stake } from "../generated/schema";
import { loadOrCreateUser, loadOrCreateHandle, categoryIdOf, loadStats, ZERO_ADDRESS } from "./helpers";

/**
 * HandleFactory.HandleCreated — materialize the top-level Handle entity from
 * the Handle contract itself so every on-chain field (creator, metadata,
 * markets, protocol wiring, LP receipts) is available in the index. One
 * creator may own many handles (each Handle links to the same Creator).
 */
export function handleHandleCreated(event: HandleCreated): void {
  let handle = loadOrCreateHandle(event.params.handleId);
  let hc = HandleContract.bind(event.params.handle);

  let owner = hc.owner();
  let user = loadOrCreateUser(owner);
  handle.owner = user.id;
  user.handleCount += 1;
  user.save();

  handle.contract = event.params.handle;
  handle.name = hc.name();
  handle.symbol = hc.symbol();
  handle.metadata = hc.metadata();
  handle.market = hc.market();
  handle.oracleFactory = hc.oracleFactory();
  handle.revenue = hc.revenue();
  handle.stake = hc.stake();
  handle.graduated = hc.graduated();
  handle.category = hc.category();
  handle.categoryId = categoryIdOf(hc.category());
  handle.verified = hc.verified();
  // Two-step ownership (OZ Ownable2Step): the factory's owner is current.
  handle.pendingOwner = ZERO_ADDRESS;
  // Enumerate the on-chain sources[] via the count getter + index getter.
  let count = hc.sourcesCount().toI32();
  for (let i: i32 = 0; i < count; i++) {
    handle.sources.push(hc.sources(BigInt.fromI32(i)));
  }
  handle.windowMinutes = hc.windowMinutes();
  handle.save();

  // Materialize the per-handle Stake receipt + track it for snapshots.
  let stake = Stake.load(hc.stake().toHexString());
  if (stake == null) {
    stake = new Stake(hc.stake().toHexString());
    stake.contract = hc.stake();
    stake.handle = handle.id;
    stake.totalSupply = BigInt.zero();
    stake.totalAssets = BigInt.zero();
    stake.valuePerToken = BigInt.fromI32(10).pow(18);
    stake.save();
  }
  StakeTemplate.create(hc.stake());

  // Track the Handle contract so its event-driven updates (SourcesChanged)
  // resolve back to this handleId.
  let addr = new HandleAddress(event.params.handle.toHexString());
  addr.handleId = event.params.handleId;
  addr.save();
  HandleTemplate.create(event.params.handle);

  let stats = loadStats();
  stats.handleCount += 1;
  stats.save();
}