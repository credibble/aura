import { forwardRef, useImperativeHandle, useMemo, type ReactNode } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { usePanZoom } from "@/hooks/usePanZoom";
import { handleSlug } from "@/lib/handle-id";
import { cn } from "@/lib/utils";
import type { CategoryId } from "@/lib/aura-data";
import {
  COLS,
  DISTRICT_SIZE,
  DISTRICTS,
  GROUND,
  ROWS,
  TILE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  districtOf,
  layoutProps,
  type WorldPlotData,
} from "@/lib/world-layout";
import { WorldPlotMarker } from "./WorldPlot";

/** Imperative moves the page's chrome (chips, search, controls) can request. */
export type WorldMapHandle = {
  focusCategory: (cat: CategoryId) => void;
  focusHandle: (idOrSlug: string) => boolean;
  fitAll: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

/** 1 unit of the world in minimap pixels. */
const MINIMAP_W = 152;
const MINIMAP_SCALE = MINIMAP_W / WORLD_WIDTH;

/** Crossroads through every district centre — a village grid you can walk. */
const ROAD_X = Array.from({ length: COLS }, (_, c) => c * DISTRICT_SIZE + DISTRICT_SIZE / 2);
const ROAD_Y = Array.from({ length: ROWS }, (_, r) => r * DISTRICT_SIZE + DISTRICT_SIZE / 2);

/**
 * The Aura Atlas viewport: a tiled top-down village of the markets. The camera
 * is `usePanZoom` (imperative); this renders the static world — ground, roads,
 * scenery — plus the handles as villagers, and the overlay chrome.
 */
export const WorldMap = forwardRef<
  WorldMapHandle,
  { plots: WorldPlotData[]; activeCategory?: CategoryId | "all" }
>(function WorldMap({ plots, activeCategory = "all" }, ref) {
  const { containerRef, layerRef, view, viewport, isPanning, flyTo, fitAll, zoomBy } = usePanZoom({
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
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
        const hit = plots.find(
          (p) =>
            p.id.toLowerCase() === key ||
            handleSlug(p.asset) === key ||
            (p.asset.name ?? "").toLowerCase() === key,
        );
        if (!hit) return false;
        flyTo(hit.x, hit.y, 1.15, 700);
        return true;
      },
      fitAll: () => fitAll(),
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(0.8),
    }),
    [plots, flyTo, fitAll, zoomBy],
  );

  const props = useMemo(() => layoutProps(), []);
  const decals = useMemo(() => props.filter((p) => p.flat), [props]);

  // Back-to-front: scenery and villagers share one y-sorted layer, so whoever is
  // lower on the map draws in front. Rebuilt only when the data changes.
  const sprites: ReactNode[] = useMemo(() => {
    const items: { y: number; node: ReactNode }[] = [
      ...props
        .filter((p) => !p.flat)
        .map((p) => ({
          y: p.y,
          node: (
            <img
              key={p.id}
              src={p.image}
              alt=""
              draggable={false}
              className="world-prop"
              style={{ left: p.x, top: p.y, width: p.size, height: p.size }}
            />
          ),
        })),
      ...plots.map((plot) => ({
        y: plot.y,
        node: <WorldPlotMarker key={plot.id} plot={plot} />,
      })),
    ];
    items.sort((a, b) => a.y - b.y);
    return items.map((i) => i.node);
  }, [props, plots]);

  const measured = viewport.w > 0;
  const viewWorldW = measured ? viewport.w / view.z : 0;
  const viewWorldH = measured ? viewport.h / view.z : 0;
  const viewLeft = view.x - viewWorldW / 2;
  const viewTop = view.y - viewWorldH / 2;

  return (
    <div
      ref={containerRef}
      className={cn(
        "world-viewport relative h-full w-full overflow-hidden rounded-2xl border border-border/70",
        isPanning ? "is-panning" : "is-idle",
      )}
      role="application"
      aria-label="Aura Atlas — a pannable village of markets. Use the arrow keys to pan, or the controls to zoom."
      tabIndex={0}
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
      {/* The world. Transformed directly by the camera — React never re-renders it to pan. */}
      <div
        ref={layerRef}
        className="world-layer"
        style={{ width: WORLD_WIDTH, height: WORLD_HEIGHT }}
      >
        {/* Ground: one tiled grass bed under everything. */}
        <div
          className="world-ground"
          style={{ backgroundImage: `url(${GROUND.grass})`, backgroundSize: `${TILE}px ${TILE}px` }}
        />

        {/* Flower/rock patches — flat on the grass, under everything else. */}
        {decals.map((p) => (
          <img
            key={p.id}
            src={p.image}
            alt=""
            draggable={false}
            className="world-decal"
            style={{ left: p.x, top: p.y, width: p.size, height: p.size }}
          />
        ))}

        {/* District plates: a barely-there frame so districts read as regions,
            separated by the roads — no tiles, so the grass bed stays continuous. */}
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

        {/* Crossroads between the districts. */}
        {ROAD_X.map((x) => (
          <span
            key={`rv-${x}`}
            className="world-road world-road--v"
            style={{
              left: x - TILE / 2,
              width: TILE,
              backgroundImage: `url(${GROUND.dirt})`,
              backgroundSize: `${TILE}px ${TILE}px`,
            }}
          />
        ))}
        {ROAD_Y.map((y) => (
          <span
            key={`rh-${y}`}
            className="world-road world-road--h"
            style={{
              top: y - TILE / 2,
              height: TILE,
              backgroundImage: `url(${GROUND.dirt})`,
              backgroundSize: `${TILE}px ${TILE}px`,
            }}
          />
        ))}

        {sprites}
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

      {/* Minimap — the whole world, with the current viewport marked. */}
      <button
        type="button"
        aria-label="Jump by clicking the minimap"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const wx = (e.clientX - rect.left) / MINIMAP_SCALE;
          const wy = (e.clientY - rect.top) / MINIMAP_SCALE;
          flyTo(wx, wy, Math.max(view.z, 0.8), 500);
        }}
        className="absolute bottom-4 left-4 hidden cursor-pointer overflow-hidden rounded-xl border border-border/70 bg-background/80 p-1.5 shadow-lg backdrop-blur sm:block"
        style={{ width: MINIMAP_W + 12, height: WORLD_HEIGHT * MINIMAP_SCALE + 12 }}
      >
        <span className="relative block h-full w-full">
          {DISTRICTS.map((d) => (
            <span
              key={d.id}
              className="absolute rounded-[3px] bg-secondary/80"
              style={{
                left: d.x * MINIMAP_SCALE,
                top: d.y * MINIMAP_SCALE,
                width: d.size * MINIMAP_SCALE,
                height: d.size * MINIMAP_SCALE,
              }}
            />
          ))}
          {measured && (
            <span
              className="absolute rounded-[3px] border border-primary bg-primary/15"
              style={{
                left: Math.max(0, viewLeft * MINIMAP_SCALE),
                top: Math.max(0, viewTop * MINIMAP_SCALE),
                width: Math.min(MINIMAP_W, viewWorldW * MINIMAP_SCALE),
                height: Math.min(WORLD_HEIGHT * MINIMAP_SCALE, viewWorldH * MINIMAP_SCALE),
              }}
            />
          )}
        </span>
      </button>

      {/* Zoom controls */}
      <div
        className="absolute bottom-4 right-4 flex flex-col overflow-hidden rounded-xl border border-border/70 bg-background/85 shadow-lg backdrop-blur"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.25)}
          className="grid h-10 w-10 place-items-center text-foreground transition-colors hover:bg-secondary"
        >
          <Plus className="h-4 w-4" />
        </button>
        <span className="h-px w-full bg-border" />
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoomBy(0.8)}
          className="grid h-10 w-10 place-items-center text-foreground transition-colors hover:bg-secondary"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="h-px w-full bg-border" />
        <button
          type="button"
          aria-label="Fit the whole world"
          onClick={() => fitAll()}
          className="grid h-10 w-10 place-items-center text-foreground transition-colors hover:bg-secondary"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      {/* First-look hint */}
      <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-border/70 bg-background/85 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
        Drag to pan · scroll to zoom · click a villager
      </div>
    </div>
  );
});
