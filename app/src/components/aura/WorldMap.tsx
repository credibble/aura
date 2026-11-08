import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePanZoom, type Insets } from "@/hooks/usePanZoom";
import { handleSlug } from "@/lib/handle-id";
import { cn } from "@/lib/utils";
import type { CategoryId } from "@/lib/aura-data";
import {
  CONTENT_HEIGHT,
  CONTENT_WIDTH,
  DISTRICTS,
  PAD_CELLS,
  WORLD_HEIGHT,
  WORLD_PROPS,
  WORLD_WIDTH,
  districtOf,
  type WorldPlotData,
} from "@/lib/world-layout";
import { WorldPlotMarker, type WorldMover } from "./WorldPlot";
import { WorldProp } from "./WorldProp";

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
 * gesture through the same numbers, so panning stays exact. Ground and
 * district plates lie flat; props and villagers counter-rotate (see
 * `--world-tilt` in styles.css) so they stand upright facing the viewer.
 */
const TILT_DEG = 40;
const TILT_PERSPECTIVE = 1500;

/** Tags that stay up when zoomed out: the top N by aura in each district… */
const STARS_PER_DISTRICT = 2;
/** …plus the biggest N gainers and N fallers on the whole map (badged). */
const MOVERS_EACH_WAY = 3;

const NO_INSETS: Insets = { top: 0, bottom: 0 };

/**
 * The Aura Atlas: a tiled top-down village of the markets, mounted full-screen
 * under the page chrome. The camera is `usePanZoom` (imperative); this renders
 * the static world — ground, district plates, scenery — plus the handles as
 * villagers. There is deliberately no on-map chrome (no minimap, no zoom
 * buttons): pan with a drag, zoom with the scroll wheel or pinch.
 *
 * `insets` are the screen bands the page's own chrome covers (hero on top,
 * dock at the bottom): the default view frames the village between them, and
 * search / district jumps land there too.
 */
export const WorldMap = forwardRef<
  WorldMapHandle,
  { plots: WorldPlotData[]; activeCategory?: CategoryId | "all"; insets?: Insets }
>(function WorldMap({ plots, activeCategory = "all", insets = NO_INSETS }, ref) {
  const {
    containerRef,
    layerRef,
    view,
    isPanning,
    hasInteracted,
    flyTo,
    flyToFramed,
    fitAll,
    zoomBy,
  } = usePanZoom({
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    tiltDeg: TILT_DEG,
    tiltPerspective: TILT_PERSPECTIVE,
    contentWidth: CONTENT_WIDTH,
    contentHeight: CONTENT_HEIGHT,
    insets,
  });

  /** Touch selection: the villager whose tag is open, waiting for a 2nd tap. */
  const [selected, setSelected] = useState<string | null>(null);
  // A touch selection also brings the villager close enough to read: the
  // overview is too small for a tag on a phone.
  // (Zoom read through a ref so `select` stays stable while the camera moves —
  // otherwise every villager would re-render on each pan frame.)
  const zoomRef = useRef(view.z);
  zoomRef.current = view.z;
  const select = useCallback(
    (id: string) => {
      setSelected(id);
      const p = plots.find((q) => q.id === id);
      if (p) flyToFramed(p.x, p.y, Math.max(zoomRef.current, 0.75), 550);
    },
    [plots, flyToFramed],
  );

  useImperativeHandle(
    ref,
    () => ({
      focusCategory: (cat) => {
        const d = districtOf(cat);
        flyToFramed(d.cx, d.cy, 0.9, 650);
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
        // its HOME plot (the full-size one) and opens its tag.
        const hit = matches.find((p) => p.primary) ?? matches[0];
        if (!hit) return false;
        flyToFramed(hit.x, hit.y, 1.15, 700);
        setSelected(hit.id);
        return true;
      },
      fitAll: () => fitAll(),
    }),
    [plots, flyToFramed, fitAll],
  );

  // Who keeps a tag when zoomed out, and who wears a mover badge. Home plots
  // only — a visitor never competes with its own home copy.
  const { stars, movers } = useMemo(() => {
    const home = plots.filter((p) => p.primary);
    const stars = new Set<string>();
    const byDistrict = new Map<CategoryId, WorldPlotData[]>();
    for (const p of home) {
      const g = byDistrict.get(p.district) ?? [];
      g.push(p);
      byDistrict.set(p.district, g);
    }
    for (const g of byDistrict.values()) {
      g.sort((a, b) => b.asset.index - a.asset.index);
      for (const p of g.slice(0, STARS_PER_DISTRICT)) stars.add(p.id);
    }
    const movers = new Map<string, WorldMover>();
    const gainers = home
      .filter((p) => p.asset.change > 0)
      .sort((a, b) => b.asset.change - a.asset.change);
    const fallers = home
      .filter((p) => p.asset.change < 0)
      .sort((a, b) => a.asset.change - b.asset.change);
    for (const p of gainers.slice(0, MOVERS_EACH_WAY)) movers.set(p.id, "up");
    for (const p of fallers.slice(0, MOVERS_EACH_WAY)) movers.set(p.id, "down");
    return { stars, movers };
  }, [plots]);

  // Villagers in paint order (back to front; `layoutWorld` sorts by y).
  const sprites: ReactNode[] = useMemo(
    () =>
      plots.map((plot) => (
        <WorldPlotMarker
          key={plot.id}
          plot={plot}
          star={stars.has(plot.id) || movers.has(plot.id)}
          mover={movers.get(plot.id) ?? null}
          selected={selected === plot.id}
          onSelect={select}
        />
      )),
    [plots, stars, movers, selected, select],
  );

  const props = useMemo(() => WORLD_PROPS.map((p) => <WorldProp key={p.id} prop={p} />), []);

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
      style={
        {
          perspective: TILT_PERSPECTIVE,
          "--world-tilt": `${TILT_DEG}deg`,
          "--world-inset-top": `${insets.top}px`,
        } as CSSProperties
      }
      onClick={(e) => {
        // A tap on open ground closes the selected villager's tag.
        if (selected && !(e.target as HTMLElement).closest(".world-plot")) setSelected(null);
      }}
      onKeyDown={(e) => {
        const step = 140 / view.z;
        if (e.key === "ArrowLeft") flyTo(view.x - step, view.y, view.z, 160);
        else if (e.key === "ArrowRight") flyTo(view.x + step, view.y, view.z, 160);
        else if (e.key === "ArrowUp") flyTo(view.x, view.y - step, view.z, 160);
        else if (e.key === "ArrowDown") flyTo(view.x, view.y + step, view.z, 160);
        else if (e.key === "+" || e.key === "=") zoomBy(1.25);
        else if (e.key === "-") zoomBy(0.8);
        else if (e.key === "0") fitAll();
        else if (e.key === "Escape") setSelected(null);
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

          {/* District plates. The name is painted flat on the floor (readable
              from the overview) and hands over to the corner pill once zoomed in. */}
          {DISTRICTS.map((d) => (
            <div
              key={d.id}
              className={cn(
                "world-district",
                activeCategory !== "all" && activeCategory !== d.id && "world-district--dim",
              )}
              style={{ left: d.x, top: d.y, width: d.size, height: d.size }}
            >
              <span aria-hidden className="world-district__floor">
                {d.label}
              </span>
              <span className="world-district__label">
                <span aria-hidden>{d.icon}</span> {d.label}
              </span>
            </div>
          ))}

          {/* The padding ring: same grid, no markets — just scenery. */}
          {PAD_CELLS.map((p) => (
            <div
              key={p.id}
              className="world-district world-district--pad"
              style={{ left: p.x, top: p.y, width: p.size, height: p.size }}
            />
          ))}

          {props}
          {sprites}
        </div>
      </div>

      {/* Horizon fog: the far edge of the floor fades into the page, so the
          hero reads as sky rather than as text laid over villagers. */}
      <div aria-hidden className="world-horizon" />

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

      {/* First-look hint — wording follows the input (pinch on touch, scroll
          with a mouse), sits clear of the dock and the list toggle, and
          retires after the first real gesture. */}
      <div
        aria-hidden
        className={cn(
          "world-hint pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border/70 bg-background/85 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur transition-opacity duration-500 lg:bottom-24",
          hasInteracted && "opacity-0",
        )}
      >
        <span className="world-hint__fine">Drag to pan · scroll to zoom · click a villager</span>
        <span className="world-hint__coarse">Drag to move · pinch to zoom · tap a villager</span>
      </div>
    </div>
  );
});
