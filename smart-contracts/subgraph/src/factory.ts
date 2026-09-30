import { BigInt } from "@graphprotocol/graph-ts";
import { OracleDeployed } from "../generated/OracleFactory/OracleFactory";
import { Oracle as OracleContract } from "../generated/OracleFactory/Oracle";
import { Window, OracleWindow } from "../generated/schema";
import { applyOracleMetadata, loadOrCreateHandle, windowId } from "./helpers";

export function handleOracleDeployed(event: OracleDeployed): void {
  let handle = loadOrCreateHandle(event.params.handleId);
  let id = windowId(event.params.handleId, event.params.windowStart);

  let win = Window.load(id);
  let isNew = win == null;
  if (win == null) {
    win = new Window(id);
    win.handle = handle.id;
    win.handleId = event.params.handleId;
    win.windowStart = event.params.windowStart;
    win.windowEnd = BigInt.zero();
    win.outcomes = [];
    win.question = "";
    win.style = "";
    win.initialProbabilities = [];
    win.prices = [];
    win.liquidity = BigInt.zero();
    win.q = [];
    win.reference = BigInt.zero();
    win.timestamp = BigInt.zero();
    win.cash = BigInt.zero();
    win.settled = false;
    win.reserved = BigInt.zero();
    win.paidOut = BigInt.zero();
    win.volume = BigInt.zero();
  }

  win.oracle = event.params.oracle;
  let meta = OracleContract.bind(event.params.oracle).try_metadata();
  if (!meta.reverted) {
    win.oracleMetadata = meta.value;
    applyOracleMetadata(win);
  }
  win.save();

  if (isNew) {
    handle.windowCount += 1;
    handle.save();
  }

  let byOracle = new OracleWindow(event.params.oracle.toHexString());
  byOracle.window = id;
  byOracle.save();
}
