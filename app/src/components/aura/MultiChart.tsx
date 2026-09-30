import { useId } from "react";
import { tightDomain } from "@/lib/chart-domain";

type Series = { data: number[]; color: string; label: string };

function pathFor(data: number[], w: number, h: number, min: number, max: number) {
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / Math.max(1, data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 8) - 4;
    return [x, y] as const;
  });
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

export type MultiChartMode = "line" | "coin" | "candles";

/** Multi-series chart matching the Polymarket featured / event charts. */
export function MultiChart({
  series,
  height = 220,
  mode = "line",
}: {
  series: Series[];
  height?: number;
  mode?: MultiChartMode;
}) {
  const id = useId();
  const w = 640;
  const h = height;
  const all = series.flatMap((s) => s.data);
  // Tight domain: tiny moves fill the chart, flat series centre instead of
  // dropping to the floor.
  const { min, max } = tightDomain(all);

  const yFor = (v: number) => h - ((v - min) / (max - min || 1)) * (h - 8) - 4;
  const n = series[0]?.data.length ?? 0;
  const xFor = (i: number) => (i / Math.max(1, n - 1)) * w;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" preserveAspectRatio="none">
      {[0.25, 0.5, 0.75].map((g) => (
        <line
          key={g}
          x1="0"
          x2={w}
          y1={h * g}
          y2={h * g}
          stroke="hsl(var(--border))"
          strokeDasharray="3 4"
        />
      ))}
      {mode === "candles"
        ? series.map((s) => {
            const step = Math.max(1, Math.ceil(s.data.length / 22));
            const barW = Math.max(2, (w / s.data.length) * step * 0.55);
            const bars = [];
            for (let i = step; i < s.data.length; i += step) {
              const prev = s.data[i - step];
              const cur = s.data[i];
              const up = cur >= prev;
              const y1 = yFor(prev);
              const y2 = yFor(cur);
              const x = xFor(i);
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
        : series.map((s) => (
            <path
              key={s.label + id}
              d={pathFor(s.data, w, h, min, max)}
              fill="none"
              stroke={s.color}
              strokeWidth="2.2"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
            />
          ))}
      {mode === "coin" &&
        series.map((s) => {
          const step = Math.max(1, Math.ceil(s.data.length / 14));
          return (
            <g key={s.label + id}>
              {s.data.map((v, i) =>
                i % step === 0 ? (
                  <circle
                    key={i}
                    cx={xFor(i)}
                    cy={yFor(v)}
                    r="3"
                    fill="hsl(var(--background))"
                    stroke={s.color}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null,
              )}
              <circle
                cx={xFor(s.data.length - 1)}
                cy={yFor(s.data[s.data.length - 1])}
                r="3.5"
                fill={s.color}
              />
            </g>
          );
        })}
    </svg>
  );
}
