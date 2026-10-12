import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { Avatar } from "@/components/Avatar";
import { handleSlug } from "@/lib/handle-id";
import { formatIndex, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CHAR_SIZE, characterFor, type WorldPlotData } from "@/lib/world-layout";

/** Head size as a fraction of the body sprite — reads as the character's face. */
const FACE = Math.round(CHAR_SIZE * 0.44);

/**
 * One handle on the map: a villager body (stable per id) wearing the handle's
 * real avatar as its head, with name + aura on a tag above — the reference look.
 * Memoised, and the camera never re-renders it (the layer is transformed
 * directly), so a whole village of these costs nothing while panning.
 */
export const WorldPlotMarker = memo(function WorldPlotMarker({ plot }: { plot: WorldPlotData }) {
  const a = plot.asset;
  const up = a.change >= 0;
  // High-aura handles cast a bigger pool of light on the ground.
  const aura = Math.round(plot.size * 2.1);

  return (
    <Link
      to="/$id"
      params={{ id: handleSlug(a) }}
      aria-label={`${a.name} — aura ${formatIndex(a.index)}`}
      className={cn("world-plot", up ? "world-plot--up" : "world-plot--down")}
      style={{ left: plot.x, top: plot.y }}
    >
      <span className="world-plot__tag">
        <span className="world-plot__name">{a.name}</span>
        <span className={cn("world-plot__meta num", up ? "text-up" : "text-down")}>
          {formatIndex(a.index)} · {formatPct(a.change)}
        </span>
      </span>
      <span className="world-char" style={{ width: CHAR_SIZE, height: CHAR_SIZE }}>
        <span aria-hidden className="world-char__aura" style={{ width: aura, height: aura }} />
        <img src={characterFor(a.id)} alt="" draggable={false} className="world-char__sprite" />
        <span className="world-char__face" style={{ width: FACE, height: FACE }}>
          <Avatar
            seed={a.id}
            image={a.image}
            metadata={a.metadata}
            imageFit={a.imageFit}
            size={FACE}
            alt={a.name}
          />
        </span>
      </span>
    </Link>
  );
});
