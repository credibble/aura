import { windowPriors, strikeFor, stepSeconds, normalCdf } from "../src/jobs/window/window-pricing";

/**
 * Window-pricing simulation — run the model against synthetic aura series and
 * print what it would price. Doubles as a smoke check (it asserts the invariants
 * and exits non-zero if any fails).
 *
 *   npx tsx scripts/window-pricing-sim.ts
 *
 * The series are generated the way the real one is stored: INTEGERS on the 1e2
 * aura scale (3040 = 30.40), on a fixed cadence, with a drift and a volatility.
 */

/** Deterministic RNG so a run is reproducible (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A drifted random walk on the 1e2 scale, rounded to integers like the chain. */
function series(opts: {
  start: number; // 1e2 units, e.g. 3040
  steps: number;
  driftPct: number; // per-step drift, %
  volPct: number; // per-step volatility, %
  seed: number;
}): number[] {
  const r = rng(opts.seed);
  const out = [opts.start];
  let v = opts.start;
  for (let i = 1; i < opts.steps; i++) {
    // Box–Muller for a normal shock, then the drift.
    const u = Math.max(1e-9, r());
    const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
    v = v * (1 + opts.driftPct / 100 + (opts.volPct / 100) * n);
    out.push(Math.max(1, Math.round(v)));
  }
  return out;
}

const ONE = 10n ** 18n;
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`     ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` ${detail}` : ""}`);
};

type Case = {
  name: string;
  points: number[];
  cadenceSec: number;
  onChainAura: number;
};

const CASES: Case[] = [
  {
    name: "ronaldo  steady climb",
    points: series({ start: 3040, steps: 24, driftPct: 0.35, volPct: 0.8, seed: 7 }),
    cadenceSec: 1800,
    onChainAura: 3040,
  },
  {
    name: "messi    drifting down",
    points: series({ start: 2875, steps: 24, driftPct: -0.3, volPct: 0.9, seed: 11 }),
    cadenceSec: 1800,
    onChainAura: 2875,
  },
  {
    name: "elon     choppy, no trend",
    points: series({ start: 4290, steps: 24, driftPct: 0, volPct: 2.5, seed: 23 }),
    cadenceSec: 1800,
    onChainAura: 4290,
  },
  {
    name: "doge     LOW aura (rounding edge)",
    points: series({ start: 1990, steps: 24, driftPct: 0.2, volPct: 1.5, seed: 31 }),
    cadenceSec: 1800,
    onChainAura: 1990,
  },
  {
    name: "btc      volatile, up bias",
    points: series({ start: 4150, steps: 48, driftPct: 0.15, volPct: 3.5, seed: 41 }),
    cadenceSec: 600,
    onChainAura: 4150,
  },
  {
    name: "quiet    perfectly flat",
    points: new Array(24).fill(2510),
    cadenceSec: 1800,
    onChainAura: 2510,
  },
  {
    name: "micro    VERY low aura (floor matters)",
    points: series({ start: 500, steps: 24, driftPct: 0.2, volPct: 1.0, seed: 53 }),
    cadenceSec: 1800,
    onChainAura: 500,
  },
  {
    name: "new      two points only",
    points: [2000, 2010],
    cadenceSec: 1800,
    onChainAura: 2010,
  },
];

const WINDOWS = [15, 30, 60];

console.log("Window pricing simulation — strike + P(YES) per window\n");

for (const c of CASES) {
  const stepSec = stepSeconds(c.points.map((_, i) => i * c.cadenceSec));
  const strike = strikeFor(c.points, c.onChainAura);
  console.log(`${c.name}`);
  console.log(
    `  ${c.points.length} points · cadence ${stepSec / 60}m · last ${(strike / 100).toFixed(2)} · ` +
      `range ${(Math.min(...c.points) / 100).toFixed(2)}–${(Math.max(...c.points) / 100).toFixed(2)}`,
  );
  for (const minutes of WINDOWS) {
    const p = windowPriors({ points: c.points, windowSec: minutes * 60, stepSec });
    const yes = BigInt(p.probabilities[0]);
    const no = BigInt(p.probabilities[1]);
    console.log(
      `    ${String(minutes).padStart(2)}m  P(YES)=${(p.model.pYes * 100).toFixed(1).padStart(5)}%  ` +
        `drift=${(p.model.drift * 100).toFixed(2).padStart(6)}%  vol=${(p.model.vol * 100).toFixed(2).padStart(5)}%  ` +
        `steps=${String(p.model.steps).padStart(2)}  ` +
        `${p.model.fallback ? "FALLBACK 50/50" : `yes=${yes} no=${no}`}`,
    );
    check("probabilities sum to exactly 1e18", yes + no === ONE);
    check("neither leg is 0 or 1", yes > 0n && no > 0n && yes < ONE && no < ONE);
    check("p is inside the [2%, 98%] band", p.model.pYes >= 0.02 && p.model.pYes <= 0.98);
    if (p.model.fallback) check("fallback means no usable history", c.points.length < 3 || c.points.every((v) => v === c.points[0]));
  }

  // The points floor: what does the model's own 0.2% floor round to at this aura?
  const floorPct = 0.2;
  const raw = (strike * floorPct) / 100;
  const rounded = Math.round(raw);
  console.log(
    `    floor check: 0.2% of ${(strike / 100).toFixed(2)} = ${raw.toFixed(3)} units → rounds to ${rounded} ` +
      `${rounded === 0 ? "(would be a DEAD tick without the +1 points floor)" : "(moves on its own)"}`,
  );
  console.log("");
}

console.log(failures === 0 ? "All pricing invariants hold.\n" : `${failures} invariant(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
