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

export const WORLD_WIDTH = COLS * DISTRICT_SIZE;
export const WORLD_HEIGHT = ROWS * DISTRICT_SIZE;

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
function hashUnit(seed: string, salt: number): number {
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

/** The nine districts, laid out in reading order (crypto → culture). */
export const DISTRICTS: WorldDistrict[] = CATEGORIES.slice(0, COLS * ROWS).map((c, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  return {
    id: c.id,
    label: c.label,
    icon: c.icon,
    tint: c.tint,
    cx: col * DISTRICT_SIZE + DISTRICT_SIZE / 2,
    cy: row * DISTRICT_SIZE + DISTRICT_SIZE / 2,
    x: col * DISTRICT_SIZE + TILE_INSET,
    y: row * DISTRICT_SIZE + TILE_INSET,
    size: DISTRICT_SIZE - TILE_INSET * 2,
  };
});

const DISTRICT_BY_ID = Object.fromEntries(DISTRICTS.map((d) => [d.id, d])) as Record<
  CategoryId,
  WorldDistrict
>;

// ----------------------------------------------------------------------------
// Tiles — CC0 art (see app/public/world/CREDITS.txt). One word of scale:
// `TILE` is a ground tile's size in world units; sprites render at `PROP`/`CHAR`
// so they stand roughly 1.75–2 tiles tall, the way the references read.
// ----------------------------------------------------------------------------
export const TILE = 64;
export const PROP_SIZE = 116;
export const CHAR_SIZE = 128;

export const GROUND = {
  grass: "/world/ground_grass.png",
  grass2: "/world/ground_grass2.png",
  grass3: "/world/ground_grass3.png",
  dirt: "/world/ground_dirt.png",
  sand: "/world/ground_sand.png",
  rock: "/world/ground_rock.png",
} as const;

/** Per-category ground so the nine districts read as different terrain. */
const DISTRICT_GROUND: Record<CategoryId, string> = {
  crypto: GROUND.rock,
  ai: GROUND.grass2,
  sports: GROUND.sand,
  people: GROUND.grass3,
  brands: GROUND.dirt,
  memes: GROUND.grass2,
  music: GROUND.grass,
  tech: GROUND.rock,
  culture: GROUND.sand,
};

export function groundFor(id: CategoryId): string {
  return DISTRICT_GROUND[id] ?? GROUND.grass;
}

export const PROPS = {
  tree: "/world/prop_tree.png",
  pine: "/world/prop_pine.png",
  autumn: "/world/prop_autumn.png",
  bush: "/world/prop_bush.png",
  mushroom: "/world/prop_mushroom.png",
  fence: "/world/prop_fence.png",
  post: "/world/prop_post.png",
  // Reused ground art, scattered as small patches.
  flowers: "/world/ground_grass3.png",
  rock: "/world/ground_rock.png",
} as const;

/** Character bodies — the handle's avatar is composited on as the head. */
export const CHARACTERS = [
  "/world/char_0.png",
  "/world/char_1.png",
  "/world/char_2.png",
  "/world/char_3.png",
  "/world/char_4.png",
  "/world/char_5.png",
] as const;

export type WorldProp = {
  id: string;
  x: number;
  y: number;
  size: number;
  image: string;
  /** Flat ground decals lie on the grass (no vertical anchor). */
  flat: boolean;
};

/**
 * Scatter decorations inside every district. Deterministic from the district id
 * and index, so the scenery never reshuffles. Kept off the central crossroads
 * (radius ≥ 150 from each district centre) so the roads stay walkable.
 */
export function layoutProps(): WorldProp[] {
  const kinds: string[] = [
    PROPS.tree,
    PROPS.tree,
    PROPS.tree,
    PROPS.tree,
    PROPS.pine,
    PROPS.pine,
    PROPS.autumn,
    PROPS.bush,
    PROPS.bush,
    PROPS.bush,
    PROPS.flowers,
    PROPS.flowers,
    PROPS.rock,
    PROPS.mushroom,
  ];
  const out: WorldProp[] = [];
  for (const d of DISTRICTS) {
    for (let i = 0; i < 26; i++) {
      const key = `${d.id}:${i}`;
      const angle = hashUnit(key, 11) * Math.PI * 2;
      // Skew outward so district centres (the crossroads) stay clear.
      const radius = (0.34 + 0.6 * hashUnit(key, 12)) * (DISTRICT_SIZE / 2 - 80);
      const kind = kinds[Math.floor(hashUnit(key, 13) * kinds.length)] ?? PROPS.tree;
      const flat = kind === PROPS.flowers || kind === PROPS.rock;
      out.push({
        id: `prop-${key}`,
        x: d.cx + Math.cos(angle) * radius,
        y: d.cy + Math.sin(angle) * radius,
        size: flat ? TILE : Math.round(PROP_SIZE * (0.85 + 0.4 * hashUnit(key, 14))),
        image: kind,
        flat,
      });
    }
  }
  return out;
}

/** The character body a handle wears — stable per id. */
export function characterFor(id: string): string {
  return CHARACTERS[Math.floor(hashUnit(id, 7) * CHARACTERS.length)] ?? CHARACTERS[0];
}

/** A handle's district — the primary category; never undefined (9 = 3×3). */
export function districtOf(id: CategoryId): WorldDistrict {
  return DISTRICT_BY_ID[id] ?? DISTRICTS[DISTRICTS.length - 1]!;
}

/**
 * Place every handle. Positions depend only on `id`, so the set can grow (new
 * handles streaming in) without any existing plot shifting. Ordered so the
 * biggest markers paint last (on top).
 */
export function layoutWorld(assets: LiveAsset[]): WorldPlotData[] {
  const peak = assets.reduce((m, a) => Math.max(m, Math.abs(a.index)), 1);
  const plots: WorldPlotData[] = assets.map((asset) => {
    const d = districtOf(asset.category);
    const angle = hashUnit(asset.id, 1) * Math.PI * 2;
    const radius = Math.sqrt(hashUnit(asset.id, 2)) * PLOT_RADIUS;
    const weight = Math.min(1, Math.sqrt(Math.abs(asset.index) / peak));
    return {
      id: asset.id,
      asset,
      x: d.cx + Math.cos(angle) * radius,
      y: d.cy + Math.sin(angle) * radius,
      size: 60 + weight * 44,
      district: asset.category,
    };
  });
  // Paint back-to-front: smaller y (higher up the world) behind larger y, so a
  // character standing "in front" overlaps the one behind it.
  plots.sort((a, b) => a.y - b.y || a.size - b.size);
  return plots;
}
