import { memo, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkline } from "@/components/aura/charts";
import { trendColor } from "@/lib/chart-domain";
import { handleSlug } from "@/lib/handle-id";
import { parseHandleMetadata } from "@/lib/handle-metadata";
import { formatIndex, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CHAR_SIZE, type WorldPlotData } from "@/lib/world-layout";
import {
  CharacterSprite,
  characterTop,
  CHARACTER_REF_TOP,
} from "@/components/aura/CharacterSprite";

/** A visiting copy (a handle's non-home district) stands this much smaller. */
const VISITOR_SCALE = 0.7;
/** How long a live-move pop stays on screen (matches the CSS keyframes). */
const POP_MS = 1800;

/** Last pointer type seen on a villager — a touch tap selects before it navigates. */
let lastPointerType = "mouse";

export type WorldMover = "up" | "down" | null;

/**
 * One handle on the map: an archetype villager (a footballer, a singer, a
 * coin, a bot … — whatever its PRIMARY category says it represents, plus a
 * name override for iconic brands) with a tag fixed above its head carrying
 * name + aura. The character is per HANDLE: identical in every district the
 * handle stands in, so it stays recognisable.
 *
 * - Size is aura: the villager scales 0.8× → 1.4× with its share of the peak
 *   index, and its glow strengthens with it.
 * - A live aura move (WS patch / indexer push) makes it hop and floats the
 *   move ("+3.20%") above its head.
 * - In a non-home district it is a smaller, faded visitor.
 * - Mouse: hovering grows the tag open to reveal the sparkline; a click opens
 *   the market. Touch has no hover, so the first tap SELECTS (the same open
 *   tag + a "View market" line) and the second tap opens the market.
 *
 * Memoised, and the camera never re-renders it (the layer is transformed
 * directly), so a whole village of these costs nothing while panning.
 */
export const WorldPlotMarker = memo(function WorldPlotMarker({
  plot,
  star = false,
  mover = null,
  selected = false,
  onSelect,
}: {
  plot: WorldPlotData;
  /** Keep the tag up even when zoomed out (top aura in its district / top mover). */
  star?: boolean;
  mover?: WorldMover;
  selected?: boolean;
  /** Touch tap on an unselected villager. */
  onSelect?: (plotId: string) => void;
}) {
  const a = plot.asset;
  const up = a.change >= 0;
  const visitor = !plot.primary;
  const s = plot.scale * (visitor ? VISITOR_SCALE : 1);
  const charSize = CHAR_SIZE * s;
  // High-aura handles cast a pool of light on the ground.
  const aura = Math.round(plot.size * 1.15 * s);
  // Breathing offset — stable per handle, so nobody breathes in sync.
  let h = 0;
  for (let i = 0; i < a.id.length; i++) h = (h * 31 + a.id.charCodeAt(i)) | 0;
  const breatheDelay = -(((h >>> 0) % 2800) / 1000);
  // Hover chart: real history when there is one; otherwise the latest real
  // move as two points, so a young handle still shows movement (same
  // fallback as the explore cards). One rule for colour: green up, red down.
  const color = trendColor(a.history, a.change);
  const data =
    a.history.length > 1
      ? a.history
      : a.change !== 0
        ? [a.index - a.change, a.index]
        : [a.index, a.index];
  // Tag gap: the tag hugs the CHARACTER's head, not the sprite box. Short
  // archetypes (a car, a sneaker) have far more headroom in the 64-unit box
  // than a person, so pull their tag down by that difference (px at this
  // villager's scale) — the gap above every character stays identical.
  const tagLift = ((characterTop(a.name, a.category) - CHARACTER_REF_TOP) * charSize) / 64;

  // Live move: when the index changes under us, hop + float the move.
  const prevIndex = useRef(a.index);
  const [pop, setPop] = useState<{ key: number; pct: number } | null>(null);
  useEffect(() => {
    const prev = prevIndex.current;
    prevIndex.current = a.index;
    if (prev === a.index || !Number.isFinite(prev) || prev === 0) return;
    const pct = ((a.index - prev) / Math.abs(prev)) * 100;
    setPop({ key: Date.now(), pct });
    const t = window.setTimeout(() => setPop(null), POP_MS);
    return () => window.clearTimeout(t);
  }, [a.index]);

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (lastPointerType === "touch" && !selected && onSelect) {
      e.preventDefault();
      onSelect(plot.id);
    }
  };

  const moverLabel = mover === "up" ? ", top gainer" : mover === "down" ? ", top faller" : "";

  return (
    <Link
      to="/$id"
      params={{ id: handleSlug(a) }}
      draggable={false}
      aria-label={`${a.name} — aura ${formatIndex(a.index)}${moverLabel}`}
      onPointerDown={(e) => {
        lastPointerType = e.pointerType;
      }}
      onClick={onClick}
      className={cn(
        "world-plot",
        up ? "world-plot--up" : "world-plot--down",
        visitor && "world-plot--visitor",
        star && !visitor && "world-plot--star",
        selected && "world-plot--selected",
      )}
      style={
        {
          left: plot.x,
          top: plot.y,
          "--glow": (0.12 + plot.weight * 0.3).toFixed(3),
        } as CSSProperties
      }
    >
      {pop && (
        <span
          key={pop.key}
          aria-hidden
          className={cn("world-plot__pop num", pop.pct >= 0 ? "text-up" : "text-down")}
        >
          {formatPct(pop.pct)}
        </span>
      )}
      <span className="world-plot__tag" style={{ "--tag-lift": `${tagLift}px` } as CSSProperties}>
        <span className="world-plot__name">
          {mover && !visitor && (
            <span aria-hidden className="world-plot__badge">
              {mover === "up" ? "🔥" : "📉"}
            </span>
          )}
          {a.name}
        </span>
        <span className={cn("world-plot__meta num", up ? "text-up" : "text-down")}>
          {formatIndex(a.index)} · {formatPct(a.change)}
        </span>
        <span className="world-plot__chart" aria-hidden>
          <span className="world-plot__chart-inner">
            <Sparkline data={data} color={color} className="world-plot__spark" />
            <span className="world-plot__cta">Tap again to open</span>
          </span>
        </span>
      </span>
      <span className="world-char" style={{ width: charSize, height: charSize }}>
        <span aria-hidden className="world-char__aura" style={{ width: aura, height: aura }} />
        <span key={pop?.key ?? 0} className={cn("world-char__hop", pop && "is-hopping")}>
          <CharacterSprite
            id={a.id}
            name={a.name}
            category={a.category}
            character={parseHandleMetadata(a.metadata).character}
            style={{ animationDelay: `${breatheDelay}s` }}
          />
        </span>
      </span>
    </Link>
  );
});
