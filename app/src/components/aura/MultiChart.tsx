import { useId } from "react";
import { percentDomain, tightDomain } from "@/lib/chart-domain";
import { formatCents } from "@/lib/format";

type Series = { data: number[]; color: string; label: string };

/** Chart viewBox units. The plot stops at `PLOT_W`; `GUTTER` is the right-hand
 *  strip the value axis lives in. */
const W = 640;
const GUTTER = 64;
const PLOT_W = W - GUTTER;
/** Fraction of the rendered width the plot occupies. `$id.tsx` aligns its
 *  HTML overlay (the aura memo markers) to this so markers sit on the series. */
export const CHART_PLOT_RATIO = PLOT_W / W;

/** Coincidence threshold, in viewBox units. The vertical scale is ~1:1, so 0.6
 *  is well under a device pixel: only series visually on top of each other
 *  qualify for the separation nudge below. */
const COINCIDENT_EPS = 0.6;
/** How far a coincident series point is nudged, per direction (viewBox units ≈
 *  px). Small enough that a level market still reads level, large enough that
 *  the two lines are unmistakably two. */
const POINT_OFFSET = 1.5;
/** End labels are fixed 10px HTML text — the SVG's non-uniform scale never
 *  reaches them — so a point-sized nudge would still overlap. Labels move on
 *  the same rule but by `LABEL_OFFSET`. */
const LABEL_OFFSET = 8;

export type MultiChartAxis = "percent" | "points";

const xAt = (i: number, n: number) => (i / Math.max(1, n - 1)) * PLOT_W;

/** Catmull-Rom-smoothed path over already-mapped (and coincidence-offset) y
 *  values. `start` lets the recent slice share the full series' x-axis instead
 *  of being stretched across the plot. */
function pathFor(y: number[], start = 0): string {
  const n = y.length;
  const pts: [number, number][] = [];
  for (let i = start; i < n; i++) pts.push([xAt(i, n), y[i]]);
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/**
 * A handful of round tick values inside [min, max]. On the percent axis the
 * domain is the fixed 0–100% space, so a market at 50/50 reads 0/50/100 — a
 * 0.4-point gap stays tiny. On the points axis the band is tight (see
 * `tightDomain`) and the ticks follow the data instead.
 */
function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) {
    out.push(Number(v.toFixed(6)));
  }
  if (out.length < 2) return [min, max];
  return out;
}

export type MultiChartMode = "line" | "coin" | "candles";

/**
 * Multi-series chart. For binary markets the question names a LEVEL ("Will @btc
 * aura rise above 41.50?") — pass it as `strike` and the chart draws that line,
 * tinted by which side of it the latest value sits on.
 *
 * The right-hand axis labels the series' own space: LMSR prices arrive as
 * probabilities, which on a binary market are the price in cents — so it reads
 * in cents (one decimal, via `formatCents`); the `points` axis is for the aura
 * lens, whose values are index points.
 */
export function MultiChart({
  series,
  height = 220,
  mode = "line",
  strike,
  axis = "percent",
}: {
  series: Series[];
  height?: number;
  mode?: MultiChartMode;
  /** Threshold from the market question (aura points), e.g. 41.5. */
  strike?: number | null;
  axis?: MultiChartAxis;
}) {
  const id = useId();
  const h = height;
  const all = series.flatMap((s) => s.data);
  // The axis unit picks the SCALE, not just the label suffix. Probabilities are
  // shares of a whole and must read against the fixed 0–100% space, so a 0.4%
  // move is 0.4% of the plot instead of being magnified by a data band that is
  // only ~0.7 points wide. Aura index points are a level, not a share, so they
  // keep the tight band (`tightDomain`) and fill the chart with their movement.
  const { min, max } = axis === "percent" ? percentDomain(all) : tightDomain(all);

  const yFor = (v: number) => h - ((v - min) / (max - min || 1)) * (h - 8) - 4;

  // --- Coincidence separation -----------------------------------------------
  // Several binary outcomes can read the same value (they start 50/50 and can
  // return to dead level at any time). Drawn truthfully, the two lines, dots
  // and labels then sit exactly on top of each other. Nudge APART only where
  // that happens; everywhere else the raw mapped y is used untouched.
  //
  // The direction is constant per series (even index up, odd index down) rather
  // than recomputed per point. A per-point "which one is lower" test flips sign
  // the instant the series cross, which re-introduces the flicker we are trying
  // to kill; a fixed direction can never flip point-to-point.
  const baseYs = series.map((s) => s.data.map((v) => yFor(v)));
  const coincideAt = (i: number, si: number) =>
    baseYs.some(
      (row, sj) =>
        sj !== si &&
        typeof row[i] === "number" &&
        Math.abs(baseYs[si]![i]! - row[i]!) < COINCIDENT_EPS,
    );
  const ys = baseYs.map((row, si) =>
    row.map((y, i) => (coincideAt(i, si) ? y + (si % 2 === 0 ? -POINT_OFFSET : POINT_OFFSET) : y)),
  );
  // Same rule at the end point, but a wider displacement so two 10px labels
  // reading the same value clear each other; clamped so neither is clipped.
  const endLabelY = series.map((s, si) => {
    if (s.data.length === 0) return null;
    const i = s.data.length - 1;
    const y = baseYs[si]![i]!;
    const nudged = coincideAt(i, si) ? y + (si % 2 === 0 ? -1 : 1) * LABEL_OFFSET : y;
    return Math.min(h - 7, Math.max(7, nudged));
  });

  function label(v: number): string {
    // A price is shown in cents (one decimal, via the shared formatter); the
    // aura lens is a level in index points and keeps a plain 1dp number.
    return axis === "percent" ? formatCents(v / 100) : Number(v.toFixed(1)).toString();
  }

  const ticks = niceTicks(min, max);

  // The strike can sit outside the visible band (the domain follows the data):
  // pin it to the edge and say which side, rather than drawing nothing.
  const hasStrike = typeof strike === "number" && Number.isFinite(strike);
  const clamped = hasStrike ? Math.min(max, Math.max(min, strike as number)) : 0;
  const last = series[0]?.data[series[0].data.length - 1];
  const above = hasStrike && typeof last === "number" ? last >= (strike as number) : false;
  const offChart = hasStrike
    ? (strike as number) > max
      ? "above"
      : (strike as number) < min
        ? "below"
        : null
    : null;
  const strikeY = hasStrike ? yFor(clamped) : 0;
  const strikeColor = above ? "hsl(var(--up))" : "hsl(var(--down))";

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox={`0 0 ${W} ${h}`}
        className="h-full w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={
          hasStrike
            ? `Aura chart with the strike at ${strike}. Latest value is ${above ? "at or above" : "below"} it.`
            : "Aura chart"
        }
      >
        {/* Dashed gridlines at the axis ticks — the axis itself is HTML on the
            right so the text isn't stretched by non-uniform scaling. */}
        {ticks.map((t) => (
          <line
            key={t}
            x1="0"
            x2={PLOT_W}
            y1={yFor(t)}
            y2={yFor(t)}
            stroke="hsl(var(--border))"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* The question's level — dashed, behind the data. */}
        {hasStrike && (
          <line
            x1="0"
            x2={PLOT_W}
            y1={strikeY}
            y2={strikeY}
            stroke={strikeColor}
            strokeWidth="1.4"
            strokeDasharray="6 5"
            opacity="0.75"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {mode === "candles"
          ? series.map((s, si) => {
              const step = Math.max(1, Math.ceil(s.data.length / 22));
              const barW = Math.max(2, (PLOT_W / s.data.length) * step * 0.55);
              const bars = [];
              for (let i = step; i < s.data.length; i += step) {
                const prev = s.data[i - step];
                const cur = s.data[i];
                const up = cur >= prev;
                const y1 = ys[si]![i - step]!;
                const y2 = ys[si]![i]!;
                const x = xAt(i, s.data.length);
                bars.push(
                  <g key={i}>
                    <line
                      x1={x}
                      x2={x}
                      y1={Math.min(y1, y2) - 3}
                      y2={Math.max(y1, y2) + 3}
                      stroke={s.color}
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                      opacity="0.75"
                    />
                    <rect
                      x={x - barW / 2}
                      y={Math.min(y1, y2)}
                      width={barW}
                      height={Math.max(1.5, Math.abs(y2 - y1))}
                      fill={up ? s.color : "hsl(var(--background))"}
                      stroke={s.color}
                      strokeWidth="1.2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>,
                );
              }
              return <g key={s.label + id}>{bars}</g>;
            })
          : series.map((s, si) => {
              // Faded history, bright recent: the older 2/3 of the line is
              // dimmed, the slice nearest "now" is full opacity.
              const count = s.data.length;
              const split = count > 6 ? Math.max(1, Math.floor(count * 0.65)) : 0;
              const faint = split > 0 ? pathFor(ys[si]!, 0) : "";
              const bright = pathFor(ys[si]!, split);
              return (
                <g key={s.label + id}>
                  {faint && (
                    <path
                      d={faint}
                      fill="none"
                      stroke={s.color}
                      strokeWidth="2.2"
                      opacity="0.28"
                      vectorEffect="non-scaling-stroke"
                      strokeLinecap="round"
                    />
                  )}
                  <path
                    d={bright}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2.2"
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
        {mode === "coin" &&
          series.map((s, si) => {
            const step = Math.max(1, Math.ceil(s.data.length / 14));
            return (
              <g key={s.label + id}>
                {s.data.map((v, i) =>
                  i % step === 0 ? (
                    <circle
                      key={i}
                      cx={xAt(i, s.data.length)}
                      cy={ys[si]![i]!}
                      r="3"
                      fill="hsl(var(--background))"
                      stroke={s.color}
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null,
                )}
                <circle
                  cx={xAt(s.data.length - 1, s.data.length)}
                  cy={ys[si]![s.data.length - 1]!}
                  r="3.5"
                  fill={s.color}
                />
              </g>
            );
          })}
        {/* The live tail: EVERY line ends in a dot with the pulse on top, in both
            modes, so the newest value is unmistakable at a glance. */}
        {series.map((s, si) => {
          if (s.data.length === 0) return null;
          const cx = xAt(s.data.length - 1, s.data.length);
          const cy = ys[si]![s.data.length - 1]!;
          return (
            <g key={`tail-${s.label}-${id}`}>
              <circle cx={cx} cy={cy} r="3.5" fill={s.color} />
              <circle className="tip-pulse" cx={cx} cy={cy} r="3.5" fill={s.color} />
            </g>
          );
        })}
      </svg>

      {/* Percentage (or points) axis, right-hand side — HTML so the text keeps
          its proportions under the chart's non-uniform scaling. */}
      {ticks.map((t) => (
        <span
          key={`tick-${t}`}
          className="num pointer-events-none absolute -translate-y-1/2 pl-1.5 text-[10px] text-muted-foreground"
          style={{ left: `${CHART_PLOT_RATIO * 100}%`, top: `${(yFor(t) / h) * 100}%` }}
        >
          {label(t)}
        </span>
      ))}

      {/* Each series' label + live value, in its own colour, anchored to the
          same last point the pulse dot is drawn at. */}
      {series.map((s, si) => {
        if (s.data.length === 0) return null;
        const cx = xAt(s.data.length - 1, s.data.length);
        const cy = endLabelY[si] ?? yFor(s.data[s.data.length - 1]);
        return (
          <span
            key={`end-${s.label}-${id}`}
            className="num pointer-events-none absolute z-10 -translate-y-1/2 whitespace-nowrap rounded-[4px] px-1 text-[10px] font-semibold"
            style={{
              left: `${(cx / W) * 100}%`,
              top: `${(cy / h) * 100}%`,
              color: s.color,
              backgroundColor: "hsl(var(--card) / 0.85)",
              transform: "translate(calc(-100% - 4px), -50%)",
            }}
          >
            {s.label} {label(s.data[s.data.length - 1])}
          </span>
        );
      })}

      {/* The strike, labelled in HTML so the text isn't stretched by the
          chart's non-uniform scaling. Non-interactive: the memo hover targets
          span the full height. */}
      {hasStrike && (
        <span
          className="num pointer-events-none absolute right-1 -translate-y-1/2 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            top: `${(strikeY / h) * 100}%`,
            color: strikeColor,
            borderColor: strikeColor,
            backgroundColor: "hsl(var(--card))",
          }}
        >
          {(strike as number).toFixed(2)}
          {offChart ? (offChart === "above" ? " ↑" : " ↓") : ""}
        </span>
      )}
    </div>
  );
}
