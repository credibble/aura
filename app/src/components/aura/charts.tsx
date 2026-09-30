import { useEffect, useId, useRef, useState } from "react";
import { motion } from "motion/react";
import NumberFlow, { type Format } from "@number-flow/react";
import { tightDomain } from "@/lib/chart-domain";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// Smooth line through points (Catmull-Rom → cubic Bézier)
// ----------------------------------------------------------------------------

type Pt = { x: number; y: number };

function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function project(data: number[], w: number, h: number, pad: number, padX = pad): Pt[] {
  const { min, max } = tightDomain(data);
  const range = max - min || 1;
  return data.map((v, i) => ({
    x: padX + (i / (data.length - 1)) * (w - padX * 2),
    y: h - pad - ((v - min) / range) * (h - pad * 2),
  }));
}

function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// ----------------------------------------------------------------------------
// ActivityChart — animated SVG area + line with live tail
// ----------------------------------------------------------------------------

export function ActivityChart({
  data,
  color,
  height = 240,
  className,
  showDot = true,
  strokeWidth = 2.25,
  padX,
  strike,
}: {
  data: number[];
  color: string;
  height?: number;
  className?: string;
  showDot?: boolean;
  strokeWidth?: number;
  /** Horizontal inset of the line — pass 0 to run the line end to end. */
  padX?: number;
  /**
   * A threshold in the SAME unit as `data` (e.g. an aura level from the market's
   * question). Drawn dashed, tinted by which side the latest value sits on, and
   * pinned to the edge with an arrow when the series is entirely on one side.
   * Only pass it for value charts — a cents/price axis has no aura level on it.
   */
  strike?: number | null;
}) {
  const gradientId = useId();
  const [ref, width] = useMeasure<HTMLDivElement>();
  const w = width || 600;
  const h = height;
  const pad = 8;
  const pts = project(data, w, h, pad, padX ?? pad);
  const line = smoothPath(pts);
  const area = pts.length
    ? `${line} L ${pts[pts.length - 1].x.toFixed(2)} ${h} L ${pts[0].x.toFixed(2)} ${h} Z`
    : "";
  const last = pts[pts.length - 1];

  // Strike geometry — same domain the line was projected with.
  const domain = tightDomain(data);
  const hasStrike = typeof strike === "number" && Number.isFinite(strike);
  const clamped = hasStrike
    ? Math.min(domain.max, Math.max(domain.min, strike as number))
    : domain.min;
  const lastValue = data[data.length - 1];
  const above = hasStrike && typeof lastValue === "number" ? lastValue >= (strike as number) : false;
  const offBand = hasStrike
    ? (strike as number) > domain.max
      ? "above"
      : (strike as number) < domain.min
        ? "below"
        : null
    : null;
  const strikeY = hasStrike
    ? h - pad - ((clamped - domain.min) / (domain.max - domain.min || 1)) * (h - pad * 2)
    : 0;
  const strikeColor = above ? "hsl(var(--up))" : "hsl(var(--down))";

  return (
    <div ref={ref} className={cn("relative w-full", className)} style={{ height }}>
      {pts.length > 1 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block overflow-visible">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {hasStrike && (
            <line
              x1="0"
              x2={w}
              y1={strikeY}
              y2={strikeY}
              stroke={strikeColor}
              strokeWidth="1.25"
              strokeDasharray="5 4"
              opacity="0.8"
            />
          )}
          <motion.path
            d={area}
            fill={`url(#${gradientId})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.9 }}
          />
          <motion.path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
            style={{ filter: `drop-shadow(0 0 5px ${color}55)` }}
          />
          {showDot && last && (
            <>
              <circle
                cx={last.x}
                cy={last.y}
                r={8}
                fill={color}
                opacity={0.35}
                className="tip-pulse"
              />
              <circle
                cx={last.x}
                cy={last.y}
                r={2.5}
                fill="#fff"
                stroke={color}
                strokeWidth={1.75}
              />
            </>
          )}
        </svg>
      )}

      {hasStrike && (
        <span
          className="num pointer-events-none absolute right-0.5 -translate-y-1/2 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            top: `${(strikeY / h) * 100}%`,
            color: strikeColor,
            borderColor: strikeColor,
            backgroundColor: "hsl(var(--card))",
          }}
        >
          {(strike as number).toFixed(2)}
          {offBand ? (offBand === "above" ? " ↑" : " ↓") : ""}
        </span>
      )}
    </div>
  );
}

export function Sparkline({
  data,
  color,
  className,
}: {
  data: number[];
  color: string;
  className?: string;
}) {
  return (
    <ActivityChart
      data={data}
      color={color}
      height={40}
      showDot={false}
      strokeWidth={1.75}
      className={className}
    />
  );
}

// ----------------------------------------------------------------------------
// NumberTicker — buttery animated numeric transitions (NumberFlow)
// ----------------------------------------------------------------------------

export function NumberTicker({
  value,
  format,
  className,
}: {
  value: number;
  format?: Format;
  className?: string;
}) {
  return (
    <NumberFlow
      value={value}
      format={format}
      respectMotionPreference={false}
      className={cn("num", className)}
    />
  );
}
