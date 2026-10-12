import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkline } from "@/components/aura/charts";
import { trendColor } from "@/lib/chart-domain";
import { handleSlug } from "@/lib/handle-id";
import { formatIndex, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CHAR_SIZE, type WorldPlotData } from "@/lib/world-layout";
import { CharacterSprite } from "@/components/aura/CharacterSprite";

/**
 * One handle on the map: an archetype villager (a footballer, a singer, a
 * coin, a bot … — whatever its district says it represents) with a tag fixed
 * above its head carrying name + aura. Hovering (or keyboard-focusing) the
 * character smoothly grows the tag open to reveal the aura sparkline.
 * Memoised, and the camera never re-renders it (the layer is transformed
 * directly), so a whole village of these costs nothing while panning.
 */
export const WorldPlotMarker = memo(function WorldPlotMarker({ plot }: { plot: WorldPlotData }) {
  const a = plot.asset;
  const up = a.change >= 0;
  // High-aura handles cast a faint pool of light on the ground.
  const aura = Math.round(plot.size * 1.15);
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

  return (
    <Link
      to="/$id"
      params={{ id: handleSlug(a) }}
      draggable={false}
      aria-label={`${a.name} — aura ${formatIndex(a.index)}`}
      className={cn("world-plot", up ? "world-plot--up" : "world-plot--down")}
      style={{ left: plot.x, top: plot.y }}
    >
      <span className="world-plot__tag">
        <span className="world-plot__name">{a.name}</span>
        <span className={cn("world-plot__meta num", up ? "text-up" : "text-down")}>
          {formatIndex(a.index)} · {formatPct(a.change)}
        </span>
        <span className="world-plot__chart" aria-hidden>
          <span className="world-plot__chart-inner">
            <Sparkline data={data} color={color} className="world-plot__spark" />
          </span>
        </span>
      </span>
      <span className="world-char" style={{ width: CHAR_SIZE, height: CHAR_SIZE }}>
        <span aria-hidden className="world-char__aura" style={{ width: aura, height: aura }} />
        <CharacterSprite
          id={a.id}
          name={a.name}
          district={plot.district}
          style={{ animationDelay: `${breatheDelay}s` }}
        />
      </span>
    </Link>
  );
});
