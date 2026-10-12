/**
 * The Aura Atlas layout — turns the flat handle list into a place.
 *
 * The world is a 3×3 grid of districts, one per category (`CATEGORIES` is
 * exactly nine). Inside its district each handle gets a position from a hash of
 * its id, so a handle never moves between renders or between a reload and a
 * reconnect — the map is a stable place, not a re-shuffle. Everything the layout
 * needs is derived here: no server field, no stored coordinates.
 *
 * Aura is NOT baked into position (that would make plots drift as the index
 * moves). It rides on the marker instead — size and glow — so the map is a
 * stable stage the live index performs on.
 */
import { CATEGORIES, type CategoryId, type LiveAsset } from "./aura-data";

/** One district cell, in world units. */
export const DISTRICT_SIZE = 1080;
export const COLS = 3;
export const ROWS = 3;
/**
 * Empty district grids ringing the real 3×3 — breathing room around the
 * village so the map reads as a place, not a wall of content. Two rings deep
 * (a 7×7 floor, 40 empty cells). The ring is visual only: no category, no
 * label, never a plot or a prop.
 */
export const PAD_DISTRICTS = 2;
export const GRID_COLS = COLS + PAD_DISTRICTS * 2;
export const GRID_ROWS = ROWS + PAD_DISTRICTS * 2;

export const WORLD_WIDTH = GRID_COLS * DISTRICT_SIZE;
export const WORLD_HEIGHT = GRID_ROWS * DISTRICT_SIZE;

/** The real 3×3 village at the world's centre — what "fit" frames. */
export const CONTENT_WIDTH = COLS * DISTRICT_SIZE;
export const CONTENT_HEIGHT = ROWS * DISTRICT_SIZE;

/** Keep plots off the tile edges. */
const TILE_INSET = 30;
const PLOT_RADIUS = DISTRICT_SIZE / 2 - 150;

export type WorldDistrict = {
  id: CategoryId;
  label: string;
  icon: string;
  tint: string;
  /** Centre, for "fly here". */
  cx: number;
  cy: number;
  /** Tile's top-left corner and size, for the background plate. */
  x: number;
  y: number;
  size: number;
};

export type WorldPlotData = {
  /** Unique per plot INSTANCE: `<handle id>:<district>` — a multi-category
   *  handle gets one plot in each of its districts, so ids must differ. */
  id: string;
  asset: LiveAsset;
  /** World coordinates of the marker centre. */
  x: number;
  y: number;
  /** Marker disc diameter, in world units (also the label's scale). */
  size: number;
  district: CategoryId;
};

/** Deterministic 32-bit hash of a string (+ salt), normalised to [0, 1). */
export function hashUnit(seed: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Finalise so nearby ids don't land next to each other.
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The nine districts, laid out in reading order (crypto → culture), centred
 *  inside the padded world grid. */
export const DISTRICTS: WorldDistrict[] = CATEGORIES.slice(0, COLS * ROWS).map((c, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  return {
    id: c.id,
    label: c.label,
    icon: c.icon,
    tint: c.tint,
    cx: (col + PAD_DISTRICTS) * DISTRICT_SIZE + DISTRICT_SIZE / 2,
    cy: (row + PAD_DISTRICTS) * DISTRICT_SIZE + DISTRICT_SIZE / 2,
    x: (col + PAD_DISTRICTS) * DISTRICT_SIZE + TILE_INSET,
    y: (row + PAD_DISTRICTS) * DISTRICT_SIZE + TILE_INSET,
    size: DISTRICT_SIZE - TILE_INSET * 2,
  };
});

/** The empty ring: every grid cell that is not one of the nine real districts. */
export type WorldPadCell = { id: string; x: number; y: number; size: number };
export const PAD_CELLS: WorldPadCell[] = (() => {
  const out: WorldPadCell[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const core =
        c >= PAD_DISTRICTS && c < PAD_DISTRICTS + COLS && r >= PAD_DISTRICTS && r < PAD_DISTRICTS + ROWS;
      if (core) continue;
      out.push({
        id: `pad-${c}-${r}`,
        x: c * DISTRICT_SIZE + TILE_INSET,
        y: r * DISTRICT_SIZE + TILE_INSET,
        size: DISTRICT_SIZE - TILE_INSET * 2,
      });
    }
  }
  return out;
})();

const DISTRICT_BY_ID = Object.fromEntries(DISTRICTS.map((d) => [d.id, d])) as Record<
  CategoryId,
  WorldDistrict
>;

// ----------------------------------------------------------------------------
// Villagers are drawn, not fetched: `CharacterSprite` renders an inline SVG
// whose face, hair and clothes are hashed from the handle id. The ground is
// the site's background colour and there is deliberately no scenery: only the
// district grids and the villagers.
// ----------------------------------------------------------------------------
/** Marker square edge, in world units. */
export const CHAR_SIZE = 128;

/** A handle's district — the primary category; never undefined (9 = 3×3). */
export function districtOf(id: CategoryId): WorldDistrict {
  return DISTRICT_BY_ID[id] ?? DISTRICTS[DISTRICTS.length - 1]!;
}

/**
 * Place every handle. Positions depend only on `id` + district, so the set can
 * grow (new handles streaming in) without any existing plot shifting. A handle
 * is placed in EVERY district one of its `categories` names — the map's version
 * of the list's tabs: Tesla stands in Tech and in Brands — one instance per
 * grid, hashed to its own spot inside each. A deterministic relaxation pass
 * then pushes apart plots whose tags would overlap, and the result is clamped
 * back inside the district disc. Ordered so the biggest markers paint last
 * (on top).
 */
export function layoutWorld(assets: LiveAsset[]): WorldPlotData[] {
  const peak = assets.reduce((m, a) => Math.max(m, Math.abs(a.index)), 1);
  const plots: WorldPlotData[] = [];
  for (const asset of assets) {
    const weight = Math.min(1, Math.sqrt(Math.abs(asset.index) / peak));
    // Every category family (fall back to the primary if the array is empty).
    const cats: CategoryId[] = asset.categories.length ? asset.categories : [asset.category];
    for (const cat of cats) {
      const d = districtOf(cat);
      const seed = `${asset.id}:${cat}`;
      const angle = hashUnit(seed, 1) * Math.PI * 2;
      const radius = Math.sqrt(hashUnit(seed, 2)) * PLOT_RADIUS;
      plots.push({
        id: seed,
        asset,
        x: d.cx + Math.cos(angle) * radius,
        y: d.cy + Math.sin(angle) * radius,
        size: 60 + weight * 44,
        district: cat,
      });
    }
  }

  // Min separation between neighbours — wide enough that name tags (and the
  // 176px hover chart) never collide. Deterministic: groups relax in id order.
  const MIN_SEP = 260;
  const byDistrict = new Map<CategoryId, WorldPlotData[]>();
  for (const p of plots) {
    const g = byDistrict.get(p.district) ?? [];
    g.push(p);
    byDistrict.set(p.district, g);
  }
  for (const group of byDistrict.values()) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    for (let pass = 0; pass < 12; pass++) {
      let moved = false;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i]!;
          const b = group[j]!;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy);
          if (dist >= MIN_SEP) continue;
          if (dist < 1) {
            dx = 1;
            dy = 0;
            dist = 1;
          }
          const push = (MIN_SEP - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    // The pushes must never evict anyone from the district disc.
    const d = districtOf(group[0]!.district);
    for (const p of group) {
      const dx = p.x - d.cx;
      const dy = p.y - d.cy;
      const r = Math.hypot(dx, dy);
      if (r > PLOT_RADIUS) {
        p.x = d.cx + (dx / r) * PLOT_RADIUS;
        p.y = d.cy + (dy / r) * PLOT_RADIUS;
      }
    }
  }

  // Paint back-to-front: smaller y (higher up the world) behind larger y, so a
  // character standing "in front" overlaps the one behind it.
  plots.sort((a, b) => a.y - b.y || a.size - b.size);
  return plots;
}
