/**
 * The window-state decision is the only thing standing between a window the
 * oracle simply had nothing to settle and a window that is genuinely settling.
 * Pin it at the boundaries.
 *
 *   node --test src/lib/window-state.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  marketWindowState,
  WINDOW_SETTLE_GRACE_MS,
  type MarketWindowState,
} from "./window-state.ts";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function stateAfterClose(msSinceClose: number, settled = false): MarketWindowState {
  return marketWindowState({ windowEnd: NOW - msSinceClose, settled }, NOW);
}

test("open window is trading", () => {
  assert.equal(marketWindowState({ windowEnd: NOW + 5 * MIN, settled: false }, NOW), "trading");
});

test("open window stays trading right up to the last millisecond", () => {
  assert.equal(marketWindowState({ windowEnd: NOW + 1, settled: false }, NOW), "trading");
});

test("at the close instant the window is awaiting, not trading", () => {
  assert.equal(stateAfterClose(0), "awaiting");
});

test("just-closed window (inside the grace) is awaiting", () => {
  assert.equal(stateAfterClose(5 * MIN), "awaiting");
});

test("grace boundary is inclusive: exactly at the grace is still awaiting", () => {
  assert.equal(stateAfterClose(WINDOW_SETTLE_GRACE_MS), "awaiting");
});

test("one millisecond past the grace the window is voiding", () => {
  assert.equal(stateAfterClose(WINDOW_SETTLE_GRACE_MS + 1), "voiding");
});

test("long-closed unresolved window (9h) is voiding", () => {
  assert.equal(stateAfterClose(9 * 60 * MIN), "voiding");
});

test("a settled window is settled regardless of elapsed time", () => {
  assert.equal(stateAfterClose(5 * MIN, true), "settled");
  assert.equal(marketWindowState({ windowEnd: NOW + 5 * MIN, settled: true }, NOW), "settled");
});

test("grace constant matches the ~20 minute sweep budget", () => {
  assert.equal(WINDOW_SETTLE_GRACE_MS, 20 * MIN);
});

test("a four-hour window keeps trading for its full length", () => {
  const fourHours = 4 * 60 * MIN;
  assert.equal(
    marketWindowState({ windowEnd: NOW + fourHours, settled: false }, NOW),
    "trading",
  );
  assert.equal(stateAfterClose(0), "awaiting");
});
