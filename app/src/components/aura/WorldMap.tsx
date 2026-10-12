import { forwardRef, useImperativeHandle, useMemo, type ReactNode } from "react";
import { usePanZoom } from "@/hooks/usePanZoom";
import { handleSlug } from "@/lib/handle-id";
import { cn } from "@/lib/utils";
import type { CategoryId } from "@/lib/aura-data";
import {
  CONTENT_HEIGHT,
  CONTENT_WIDTH,
  DISTRICTS,
  PAD_CELLS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  districtOf,
  type WorldPlotData,
} from "@/lib/world-layout";
import { WorldPlotMarker } from "./WorldPlot";

/** Imperative moves the page's chrome (search) can request. */
export type WorldMapHandle = {
  focusCategory: (cat: CategoryId) => void;
  focusHandle: (idOrSlug: string) => boolean;
  fitAll: () => void;
};

/** How far the ground extends past the world edge (full-screen bleed). */
const GROUND_PAD = 2600;

/**
 * The camera's top-angle view: the plane is rotated this far about the x-axis
 * and viewed through this much perspective. `usePanZoom` un-projects every
 * gesture through the same numbers, so panning stays exact. Ground, roads and
 * district plates lie flat; props and villagers counter-rotate (see
 * `--world-tilt` in styles.css) so they stand upright facing the viewer.
 */
const TILT_DEG = 40;
const TILT_PERSPECTIVE = 1500;

/**
 * The Aura Atlas: a tiled top-down village of the markets, mounted full-screen
 * under the page chrome. The camera is `usePanZoom` (imperative); this renders
 * the static world — ground, roads, scenery — plus the handles as villagers.
 * There is deliberately no on-map chrome (no minimap, no zoom buttons): pan
 * with a drag, zoom with the scroll wheel or pinch.
 */
export const WorldMap = forwardRef<
  WorldMapHandle,
  { plots: WorldPlotData[]; activeCategory?: CategoryId | "all" }
>(function WorldMap({ plots, activeCategory = "all" }, ref) {
  const { containerRef, layerRef, view, isPanning, flyTo, fitAll, zoomBy } = usePanZoom({
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    tiltDeg: TILT_DEG,
    tiltPerspective: TILT_PERSPECTIVE,
    contentWidth: CONTENT_WIDTH,
    contentHeight: CONTENT_HEIGHT,
  });

  useImperativeHandle(
    ref,
    () => ({
      focusCategory: (cat) => {
        const d = districtOf(cat);
        flyTo(d.cx, d.cy, 0.9, 650);
      },
      focusHandle: (idOrSlug) => {
        const key = idOrSlug.replace(/^@/, "").toLowerCase();
        const matches = plots.filter(
          (p) =>
            p.asset.id.toLowerCase() === key ||
            handleSlug(p.asset) === key ||
            (p.asset.name ?? "").toLowerCase() === key,
        );
        // A multi-category handle stands in several districts: search flies to
        // the one in its PRIMARY district (its "home" plot).
        const hit =
          matches.find((p) => p.district === p.asset.category) ?? matches[0];
        if (!hit) return false;
        flyTo(hit.x, hit.y, 1.15, 700);
        return true;
      },
      fitAll: () => fitAll(),
    }),
    [plots, flyTo, fitAll],
  );

  // Back-to-front: villagers share one y-sorted layer, so whoever is lower on
  // the map draws in front. Rebuilt only when the data changes.
  const sprites: ReactNode[] = useMemo(() => {
    const items: { y: number; node: ReactNode }[] = plots.map((plot) => ({
      y: plot.y,
      node: <WorldPlotMarker key={plot.id} plot={plot} />,
    }));
    items.sort((a, b) => a.y - b.y);
    return items.map((i) => i.node);
  }, [plots]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "world-viewport relative h-full w-full overflow-hidden",
        isPanning ? "is-panning" : "is-idle",
      )}
      role="application"
      aria-label="Aura Atlas — a pannable village of markets. Drag to pan, scroll to zoom, or use the arrow keys."
      tabIndex={0}
      style={{ perspective: TILT_PERSPECTIVE, ["--world-tilt" as string]: `${TILT_DEG}deg` }}
      onKeyDown={(e) => {
        const step = 140 / view.z;
        if (e.key === "ArrowLeft") flyTo(view.x - step, view.y, view.z, 160);
        else if (e.key === "ArrowRight") flyTo(view.x + step, view.y, view.z, 160);
        else if (e.key === "ArrowUp") flyTo(view.x, view.y - step, view.z, 160);
        else if (e.key === "ArrowDown") flyTo(view.x, view.y + step, view.z, 160);
        else if (e.key === "+" || e.key === "=") zoomBy(1.25);
        else if (e.key === "-") zoomBy(0.8);
        else if (e.key === "0") fitAll();
        else return;
        e.preventDefault();
      }}
    >
      {/* The tilt wrapper gives the plane its top-angle perspective; the world
          inside it is transformed directly by the camera — React never
          re-renders it to pan. */}
      <div className="world-tilt" style={{ transform: `rotateX(${TILT_DEG}deg)` }}>
        <div
          ref={layerRef}
          className="world-layer"
          style={{ width: WORLD_WIDTH, height: WORLD_HEIGHT }}
        >
          {/* Ground: the site's own background colour, padded far past the world
              edge so a full-screen viewport never shows off-world bands. */}
          <div
            className="world-ground"
            style={{
              left: -GROUND_PAD,
              top: -GROUND_PAD,
              width: WORLD_WIDTH + GROUND_PAD * 2,
              height: WORLD_HEIGHT + GROUND_PAD * 2,
            }}
          />

          {/* District plates: a barely-there frame so districts read as regions,
              separated by the roads. */}
          {DISTRICTS.map((d) => (
            <div
              key={d.id}
              className={cn(
                "world-district",
                activeCategory !== "all" && activeCategory !== d.id && "world-district--dim",
              )}
              style={{ left: d.x, top: d.y, width: d.size, height: d.size }}
            >
              <span className="world-district__label">
                <span aria-hidden>{d.icon}</span> {d.label}
              </span>
            </div>
          ))}

          {/* The empty ring: same grid, no content — room to breathe. */}
          {PAD_CELLS.map((p) => (
            <div
              key={p.id}
              className="world-district world-district--pad"
              style={{ left: p.x, top: p.y, width: p.size, height: p.size }}
            />
          ))}

          {sprites}
        </div>
      </div>

      {plots.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="rounded-2xl border border-border/70 bg-card/90 px-6 py-5 text-center backdrop-blur">
            <p className="text-[15px] font-semibold">Nothing&apos;s farming yet</p>
            <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">
              Handles pop up the second they start publishing aura on-chain.
            </p>
          </div>
        </div>
      )}

      {/* First-look hint — clear of the floating dock on desktop. */}
      <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-border/70 bg-background/85 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur lg:bottom-24">
        Drag to pan · scroll to zoom · click a villager
      </div>
    </div>
  );
});
