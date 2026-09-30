import { BigInt } from "@graphprotocol/graph-ts";
import {
  DepositFeeRangeSet,
  MaxFeeAuraSet,
  MarketFeeBpsSet,
  MinWindowSecondsSet,
  WindowPaddingSet,
} from "../generated/Configurator/Configurator";
import { Config } from "../generated/schema";

/**
 * Configurator → the singleton `Config` entity. Every owner update keeps the
 * index in sync with the on-chain tunables (fee curve, window rules).
 */
const ID = "config";

function config(): Config {
  let c = Config.load(ID);
  if (c == null) {
    c = new Config(ID);
    c.depositFeeMinBps = 0;
    c.depositFeeMaxBps = 0;
    c.maxFeeAura = BigInt.zero();
    c.marketFeeBps = 0;
    c.minWindowSeconds = BigInt.zero();
    c.windowPadding = BigInt.zero();
  }
  return c;
}

export function handleDepositFeeRangeSet(event: DepositFeeRangeSet): void {
  let c = config();
  c.depositFeeMinBps = event.params.minBps.toI32();
  c.depositFeeMaxBps = event.params.maxBps.toI32();
  c.save();
}

export function handleMaxFeeAuraSet(event: MaxFeeAuraSet): void {
  let c = config();
  c.maxFeeAura = event.params.maxFeeAura;
  c.save();
}

export function handleMarketFeeBpsSet(event: MarketFeeBpsSet): void {
  let c = config();
  c.marketFeeBps = event.params.bps.toI32();
  c.save();
}

export function handleMinWindowSecondsSet(event: MinWindowSecondsSet): void {
  let c = config();
  c.minWindowSeconds = event.params.minWindowSeconds;
  c.save();
}

export function handleWindowPaddingSet(event: WindowPaddingSet): void {
  let c = config();
  c.windowPadding = event.params.windowPadding;
  c.save();
}