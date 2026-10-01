// Tiny boundary check for the Countdown's display shape. Not a test framework:
// it re-derives the literal strings and asserts the four boundaries the ticket
// cares about, printing each one.
//
// The rule under test: the shape comes from the WINDOW'S LENGTH, not the time
// remaining. A 3600s window is `hh:mm:ss` for its whole life; a 3599s window is
// `mm:ss` for its whole life.

const HOUR_MS = 3_600_000;

/** Mirror of Countdown's formatting, kept in sync by hand (5 lines). */
function format(remainingMs, windowMs) {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return windowMs >= HOUR_MS
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

const cases = [
  // [name, window length ms, remaining ms, expected]
  ["3600s window at open", HOUR_MS, HOUR_MS, "01:00:00"],
  ["3600s window, final second", HOUR_MS, 1000, "00:00:01"],
  ["3600s window, closed", HOUR_MS, 0, "00:00:00"],
  ["3599s window at open", HOUR_MS - 1000, HOUR_MS - 1000, "59:59"],
  ["59s window at open", 59_000, 59_000, "00:59"],
  ["59s window, closed", 59_000, 0, "00:00"],
];

let failed = 0;
for (const [name, windowMs, remaining, expected] of cases) {
  const got = format(remaining, windowMs);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(28)} -> "${got}"  (expected "${expected}")`);
}

// The regression this fixes: an hour window must NOT flip shape a second in.
const firstSecond = format(HOUR_MS - 1000, HOUR_MS);
const stillSameShape = firstSecond.startsWith("00:");
console.log(
  `${stillSameShape ? "PASS" : "FAIL"}  hour window, 1s elapsed      -> "${firstSecond}"  (stays hh:mm:ss)`,
);
if (!stillSameShape) failed++;

console.log(failed === 0 ? "\nAll countdown boundary checks passed." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
