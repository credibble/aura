/**
 * Portfolio summary contract test — the realised/unrealised split.
 *
 *   node scripts/check-portfolio-summary.mjs
 *
 * Pins the exact fixture that used to display wrong: a flat OPEN position plus a
 * settled WINNER whose payout was counted as an unrealised gain and divided by
 * the combined cost basis of both rows.
 */
import { summarisePositions } from "../src/lib/portfolio-summary.ts";

// OPEN: NO @98¢, 10.2 shares, cost 10.00, value 10.00 (flat).
const flat = { shares: 10.2, price: 10 / 10.2, cost: 10, settled: false, claimable: 0 };
// SETTLED WINNER: YES, 57.65 shares, cost 20.00, claimable 57.65.
const winner = { shares: 57.65, price: 1, cost: 20, settled: true, claimable: 57.65 };

const s = summarisePositions([flat, winner]);

const near = (a, b) => Math.abs(a - b) < 1e-9;
const checks = [
  ["unrealised", near(s.unrealised, 0), s.unrealised.toFixed(2), "0.00"],
  ["unrealisedPct", near(s.unrealisedPct, 0), `${s.unrealisedPct.toFixed(1)}%`, "0.0%"],
  ["realised", near(s.realised, 37.65), `+${s.realised.toFixed(2)}`, "+37.65"],
  ["realisedPct", near(s.realisedPct, 188.25), `${s.realisedPct.toFixed(1)}%`, "188.3%"],
  ["claimable", near(s.claimable, 57.65), s.claimable.toFixed(2), "57.65"],
  ["wins (flat is NOT up)", s.wins === 1, String(s.wins), "1"],
  ["openCount", s.openCount === 2, String(s.openCount), "2"],
];

let failed = 0;
for (const [name, ok, got, want] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(24)} ${got.padEnd(10)} (expected ${want})`);
}

// The old, wrong derivation, for the record: a settled payout counted as
// unrealised, and divided by the combined basis of both positions.
const oldEquity = flat.shares * flat.price + winner.shares * winner.price;
const oldCost = Math.max(0, flat.cost) + Math.max(0, winner.cost);
const oldPnl = oldEquity - oldCost;
const oldPct = oldCost > 0 ? (oldPnl / oldCost) * 100 : 0;
console.log(
  `\nbefore: Unrealised +${oldPnl.toFixed(2)} (${oldPct.toFixed(1)}%)` +
    `  ->  after: Unrealised ${s.unrealised.toFixed(2)} (${s.unrealisedPct.toFixed(1)}%) · ` +
    `Realised +${s.realised.toFixed(2)} (${s.realisedPct.toFixed(1)}%)`,
);

console.log(
  failed === 0 ? "\nAll portfolio summary checks passed.\n" : `\n${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
