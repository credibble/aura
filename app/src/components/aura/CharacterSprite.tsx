import { memo, useId, type CSSProperties, type ReactNode } from "react";
import { hashUnit } from "@/lib/world-layout";
import type { CategoryId } from "@/lib/aura-data";
import type { HandleCharacter } from "@/lib/handle-metadata";
import { cn } from "@/lib/utils";

/**
 * The villager — now an ARCHETYPE villager. Every character is drawn as a
 * 64×64 vector figure that MATCHES what the handle represents: a footballer
 * with a ball for Sports, a singer with headphones for Music, a gold coin for
 * Crypto, a bot for AI, a laughing cat for Memes (😹), a popcorn bucket for
 * Culture, a gamepad for Tech, a suited founder for Brands, a plain person
 * for People — and iconic brands get their real-world object by name (Tesla
 * is a car, Apple a phone, Nike a sneaker, Amazon a box, SpaceX a rocket).
 *
 * Archetype = brand-name override first, then the handle's PRIMARY category
 * (the first of its categories) — so a handle is ONE character, identical in
 * every district it stands in (OpenAI is a bot everywhere, Taylor Swift a
 * singer everywhere, Tesla a car everywhere).
 *
 * All of it stays hashed from the handle id (skin, hair, iris, garment, and
 * each archetype's own palette + pose variants), so every handle keeps the
 * same look everywhere on the map — no sprite files, no avatars, crisp at
 * any zoom. Every archetype keeps the shared DNA: the villager eyes/smile,
 * feet on the ground line, tiny arms/legs/shoes, and the 64×64 box the aura
 * glow and `--char-scale` (written by the camera) are sized against.
 */

// [base, shade] pairs — warm skin, hair, jackets, pants, shoes.
const SKIN = [
  ["#F8DCC2", "#E5BF9C"],
  ["#F1C79E", "#DCA97C"],
  ["#DCA97B", "#C4905C"],
  ["#C1875A", "#A66E46"],
  ["#9E6742", "#855433"],
  ["#7C4E33", "#65402A"],
] as const;

const HAIR = [
  ["#332D27", "#211D19"], // near-black
  ["#5A3A22", "#432B19"], // brown
  ["#A5703A", "#875B2C"], // chestnut
  ["#D9A441", "#B98A2E"], // blond
  ["#B34A2E", "#933A22"], // red
  ["#918D87", "#726E68"], // silver
] as const;

const IRIS = ["#4A3220", "#5C4024", "#3E6B8C", "#4E7A52", "#7A6A3A", "#3B3B3F"] as const;

const GARMENT = [
  ["#3B5B8C", "#2E4973"], // navy
  ["#2F6D6B", "#235452"], // teal
  ["#7C3B47", "#612C37"], // maroon
  ["#5F6B3A", "#49532F"], // olive
  ["#8A5A34", "#6D4527"], // rust
  ["#5B4A7C", "#453663"], // plum
  ["#4A5259", "#394046"], // slate
  ["#3E6B4A", "#2E5339"], // forest
] as const;

const PANTS = [
  ["#3A4557", "#2C3444"], // denim
  ["#3C3C40", "#2D2D30"], // charcoal
  ["#5A4632", "#443525"], // brown
  ["#4B4E3F", "#393C30"], // dark khaki
] as const;

const SHOES = ["#2B2B30", "#4A362A", "#56565C"] as const;

// Archetype palettes — football kits, tokens, robots, fur, shells, rides.
const KIT = [
  ["#E4572E", "#B93D1B"], // orange
  ["#2F80ED", "#1C5BB0"], // blue
  ["#27AE60", "#1B7A44"], // green
  ["#F2C94C", "#C79E28"], // gold
  ["#BB6BD9", "#8E48AC"], // purple
  ["#EB5757", "#B33A3A"], // red
] as const;

const COIN = [
  ["#F4C95D", "#C79A2E"], // gold
  ["#DEE3E9", "#A6AEB9"], // silver
  ["#E3A268", "#B0703A"], // copper
] as const;

const LED = ["#5AC8FA", "#7DFCB0", "#FFD166", "#FF8FD1"] as const;

const FUR = [
  ["#F0B25A", "#C98A35"], // ginger
  ["#9CA3AD", "#737A84"], // gray
  ["#EFE7D9", "#CBC0AA"], // cream
  ["#6B5B4E", "#4E4139"], // chocolate
] as const;

const SHELL = [
  ["#3D4453", "#2A303C"], // slate
  ["#E4573C", "#B23A26"], // red
  ["#3FA9A0", "#2B7C75"], // teal
] as const;

const RIDE = [
  ["#E2504A", "#AF312C"], // red
  ["#4C8BE0", "#2F63AE"], // blue
  ["#F0B93E", "#C48F22"], // yellow
  ["#8E63D6", "#64409F"], // violet
] as const;

/** Fringe shapes, all sharing the same dome over the head. */
const HAIR_PATHS = [
  // Wavy — soft locks breaking across the forehead.
  "M22.4,14.6 C22.4,6.2 26.6,3 32,3 C37.4,3 41.6,6.2 41.6,14.6 C41,12.2 38.9,11.4 36.4,12.2 C34,13 31.7,12.2 29.2,11.8 C26.6,11.4 23.6,12 22.4,14.6 Z",
  // Bowl — an even fringe across the brow.
  "M22.4,14.6 C22.4,6.2 26.6,3 32,3 C37.4,3 41.6,6.2 41.6,14.6 L41.6,11.7 C40.2,11 36.4,10.6 32,10.6 C27.6,10.6 23.8,11 22.4,11.7 Z",
  // Spiky — tips over the dome.
  "M22.4,14.6 C22.4,6.2 26.6,3 32,3 C37.4,3 41.6,6.2 41.6,14.6 L41.6,11.6 L38.8,8.8 L36.4,11.8 L32.4,8.4 L29.6,11.8 L26,9 L22.4,11.8 Z",
] as const;

/** Long-hair fringes — same dome, plus shoulder-length side locks (female
 *  handles). One path each: the fringe over the forehead + two locks. */
const HAIR_LONG_PATHS = [
  // Wavy, shoulder-length.
  "M22.4,14.6 C22.4,6.2 26.6,3 32,3 C37.4,3 41.6,6.2 41.6,14.6 C41,12.2 38.9,11.4 36.4,12.2 C34,13 31.7,12.2 29.2,11.8 C26.6,11.4 23.6,12 22.4,14.6 Z M22.6,12 C20.8,16.5 20.2,22 21.2,28.5 C21.6,30.3 24.4,30.3 24.6,28.4 C24.8,23.8 24.2,17.6 25.2,13.6 Z M41.4,12 C43.2,16.5 43.8,22 42.8,28.5 C42.4,30.3 39.6,30.3 39.4,28.4 C39.2,23.8 39.8,17.6 38.8,13.6 Z",
  // Straight bob — blunter locks.
  "M22.4,14.6 C22.4,6.2 26.6,3 32,3 C37.4,3 41.6,6.2 41.6,14.6 L41.6,11.7 C40.2,11 36.4,10.6 32,10.6 C27.6,10.6 23.8,11 22.4,11.7 Z M22.4,11.8 C21.2,17 21,23 21.6,29 L24.8,29 C24.2,23 24,17 25,12.6 Z M41.6,11.8 C42.8,17 43,23 42.4,29 L39.2,29 C39.8,23 40,17 39,12.6 Z",
] as const;

type Duo = readonly [string, string];

function pick<T>(palette: readonly T[], id: string, salt: number): T {
  return palette[Math.floor(hashUnit(id, salt) * palette.length)] ?? palette[0]!;
}

/** Index into a palette, or undefined when absent/out of range. Metadata is
 *  untrusted, so a bad index just falls back to the hashed default. */
function atOr<T>(arr: readonly T[], i: number | undefined): T | undefined {
  return typeof i === "number" && Number.isInteger(i) && i >= 0 && i < arr.length
    ? arr[i]
    : undefined;
}

/** Palettes exposed so "Start farming aura" can render swatches + a live preview
 *  without duplicating the sprite's colour lists. */
export const CHARACTER_SKIN = SKIN;
export const CHARACTER_HAIR = HAIR;
export const CHARACTER_OUTFIT = GARMENT;
export const CHARACTER_HAIR_STYLES = HAIR_PATHS.length;

// ----------------------------------------------------------------------------
// Archetype resolution.
// ----------------------------------------------------------------------------
type Archetype =
  | "person"
  | "founder"
  | "footballer"
  | "singer"
  | "coin"
  | "bot"
  | "cat"
  | "popcorn"
  | "controller"
  | "car"
  | "phone"
  | "sneaker"
  | "box"
  | "rocket";

/** Primary category → the archetype that handle stands in, everywhere. */
const CATEGORY_ARCHETYPE: Record<CategoryId, Archetype> = {
  crypto: "coin",
  ai: "bot",
  sports: "footballer",
  music: "singer",
  people: "person",
  brands: "founder",
  memes: "cat",
  tech: "controller",
  culture: "popcorn",
};

/**
 * Iconic brands get their real-world object instead of the generic founder,
 * in EVERY district they stand in. One line per brand to add another.
 */
const BRAND_OBJECT: Record<string, Archetype> = {
  tesla: "car",
  apple: "phone",
  nike: "sneaker",
  amazon: "box",
  spacex: "rocket",
};

/**
 * Identity overrides — iconic handles wear their REAL colours instead of the
 * hashed archetype palette (Bitcoin's coin is orange, Solana's is the
 * purple→green gradient, Messi wears Argentina, Ronaldo Portugal). Name-keyed
 * like BRAND_OBJECT: one line per handle.
 */
const IDENTITY: Record<string, { coin?: Duo; kit?: Duo }> = {
  bitcoin: { coin: ["#F7931A", "#C4700F"] }, // Bitcoin orange
  ethereum: { coin: ["#627EEA", "#4A62B8"] }, // Ethereum blue
  solana: { coin: ["#9945FF", "#14F195"] }, // Solana purple → green gradient
  "lionel messi": { kit: ["#74ACDF", "#FFFFFF"] }, // Argentina sky blue + white
  ronaldo: { kit: ["#046A38", "#DA291C"] }, // Portugal green + red
};

/** Known female handles — they get shoulder-length hair instead of the short
 *  fringe. Name-keyed like BRAND_OBJECT: one line per handle. */
const LONG_HAIR = new Set(["taylor swift"]);

/** Darken a #rrggbb colour toward black by a ratio (0–1). */
function darken(hex: string, by: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.round(v * (1 - by)));
  return `#${(((1 << 24) | (ch((n >> 16) & 255) << 16) | (ch((n >> 8) & 255) << 8) | ch(n & 255)) >>> 0).toString(16).slice(1)}`;
}

function archetypeFor(name: string, primary: CategoryId): Archetype {
  const key = name.trim().toLowerCase();
  return BRAND_OBJECT[key] ?? CATEGORY_ARCHETYPE[primary] ?? "person";
}

/**
 * Where each archetype's art starts in the 64-unit viewBox (its topmost
 * pixel, measured from the rendered gallery). A car's roof sits at y≈23 and a
 * sneaker's at y≈37.5 while a person's hair starts at y≈3 — so a tag pinned a
 * fixed distance above the sprite BOX would float far higher over short
 * characters. The plot pulls its tag down by (top − ref) to hug every
 * character's head at the same gap instead.
 */
const ARCHETYPE_TOP: Record<Archetype, number> = {
  person: 3,
  founder: 3,
  footballer: 3,
  singer: 3,
  coin: 10.4,
  bot: 0.2,
  cat: 4.4,
  popcorn: 23.2,
  controller: 27,
  car: 23,
  phone: 8,
  sneaker: 37.5,
  box: 26,
  rocket: 7,
};

/** The reference top: a plain villager's hair. The tag gap is defined on it. */
export const CHARACTER_REF_TOP = 3;

/** Top of this handle's art in the 64-unit viewBox (see ARCHETYPE_TOP). */
export function characterTop(name: string | undefined, category: CategoryId): number {
  return ARCHETYPE_TOP[archetypeFor(name ?? "", category)] ?? CHARACTER_REF_TOP;
}

// ----------------------------------------------------------------------------
// Shared drawing fragments — the person, reused by every humanoid archetype.
// ----------------------------------------------------------------------------

/** The villager face: blush, brows, lidded eyes, nose, smile. */
function Face({ skin, iris, hair }: { skin: Duo; iris: string; hair: Duo }) {
  return (
    <>
      <ellipse cx="26.2" cy="19.7" rx="2" ry="1.1" fill="#E2857A" opacity="0.25" />
      <ellipse cx="37.8" cy="19.7" rx="2" ry="1.1" fill="#E2857A" opacity="0.25" />
      <path
        d="M26,13.3 Q28.7,12.4 31.4,13.2"
        fill="none"
        stroke={hair[1]}
        strokeWidth="1.15"
        strokeLinecap="round"
      />
      <path
        d="M32.6,13.2 Q35.3,12.4 38,13.3"
        fill="none"
        stroke={hair[1]}
        strokeWidth="1.15"
        strokeLinecap="round"
      />
      <ellipse cx="28.7" cy="16.6" rx="2.45" ry="2.75" fill="#FFFDF9" />
      <ellipse cx="35.3" cy="16.6" rx="2.45" ry="2.75" fill="#FFFDF9" />
      <circle cx="28.7" cy="16.9" r="1.85" fill={iris} />
      <circle cx="35.3" cy="16.9" r="1.85" fill={iris} />
      <circle cx="28.7" cy="16.9" r="0.95" fill="#171412" />
      <circle cx="35.3" cy="16.9" r="0.95" fill="#171412" />
      <circle cx="28" cy="16.05" r="0.6" fill="#fff" opacity="0.95" />
      <circle cx="34.6" cy="16.05" r="0.6" fill="#fff" opacity="0.95" />
      <path
        d="M26.3,15 Q28.7,13.7 31.1,15"
        fill="none"
        stroke="#3A2A20"
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.6"
      />
      <path
        d="M32.9,15 Q35.3,13.7 37.7,15"
        fill="none"
        stroke="#3A2A20"
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.6"
      />
      <path
        d="M31.5,18.6 Q32,20 33,19.4"
        fill="none"
        stroke={skin[1]}
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M30.2,21.3 Q32,22.7 33.8,21.3"
        fill="none"
        stroke="#9A5B4C"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.85"
      />
    </>
  );
}

/** Ears + head + face + hair + sheen — the whole head. */
function Head({
  uid,
  skin,
  hair,
  hairPath,
  iris,
}: {
  uid: string;
  skin: Duo;
  hair: Duo;
  hairPath: string;
  iris: string;
}) {
  return (
    <>
      {/* Ears */}
      <circle cx="23.4" cy="16" r="2.5" fill={skin[0]} />
      <circle cx="40.6" cy="16" r="2.5" fill={skin[0]} />
      <circle cx="23.7" cy="16" r="1.1" fill={skin[1]} opacity="0.85" />
      <circle cx="40.3" cy="16" r="1.1" fill={skin[1]} opacity="0.85" />

      {/* Head */}
      <path
        d="M23,13.6 C23,6.6 26.7,4 32,4 C37.3,4 41,6.6 41,13.6 C41,19.2 38.5,24.2 32,24.2 C25.5,24.2 23,19.2 23,13.6 Z"
        fill={`url(#${uid}-s)`}
      />

      <Face skin={skin} iris={iris} hair={hair} />

      {/* Hair (over the forehead) + sheen */}
      <path d={hairPath} fill={hair[0]} />
      <path
        d="M26.4,5.4 Q30.2,4.1 34.4,5.6"
        fill="none"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.2"
      />
    </>
  );
}

/** Straight legs + shoes (the shared human ground stance). */
function Legs({ uid, pants, shoe }: { uid: string; pants: Duo; shoe: string }) {
  return (
    <>
      <rect x="23.5" y="42" width="7" height="17.6" rx="3" fill={`url(#${uid}-p)`} />
      <rect x="33.5" y="42" width="7" height="17.6" rx="3" fill={`url(#${uid}-p)`} />
      <rect x="21.8" y="57.6" width="10.4" height="4.4" rx="2.2" fill={shoe} />
      <rect x="31.8" y="57.6" width="10.4" height="4.4" rx="2.2" fill={shoe} />
      <rect x="23.1" y="58.3" width="7.2" height="1.3" rx="0.65" fill="#fff" opacity="0.14" />
      <rect x="33.1" y="58.3" width="7.2" height="1.3" rx="0.65" fill="#fff" opacity="0.14" />
    </>
  );
}

/** Torso — shoulders, collar seam, zipper, hem (a zip jacket, or a suit). */
function Torso({
  uid,
  garment,
  grad = "g",
  shirt,
  tie,
}: {
  uid: string;
  garment: Duo;
  /** Gradient suffix — footballers swap the jacket for a kit (`k`). */
  grad?: string;
  /** White shirt V + tie — the founder's suit. */
  shirt?: boolean;
  tie?: string;
}) {
  return (
    <>
      <path
        d="M26,23 H38 C42,23 45,26.2 45,30.2 V44.6 C45,46.2 43.8,47.4 42.2,47.4 H21.8 C20.2,47.4 19,46.2 19,44.6 V30.2 C19,26.2 22,23 26,23 Z"
        fill={`url(#${uid}-${grad})`}
      />
      <path
        d="M29.4,23.4 L32,28.8 L34.6,23.4"
        fill="none"
        stroke={garment[1]}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {shirt ? (
        <>
          {/* Shirt V + tie — reads as a suit at map scale. */}
          <path d="M29.4,23.4 L32,29.6 L34.6,23.4 L33.4,23 L32,25.4 L30.6,23 Z" fill="#F4F1EA" />
          <path d="M32,29.2 L30.9,31.6 L32,37.4 L33.1,31.6 Z" fill={tie} />
        </>
      ) : (
        <path d="M32,28.8 V47.3" stroke={garment[1]} strokeWidth="1" opacity="0.55" />
      )}
      <path d="M19.8,45.4 H44.2" stroke={garment[1]} strokeWidth="1.6" opacity="0.5" />
      {/* Jacket shadow falling on the pants */}
      <path d="M24,48.5 H40" stroke="#000" strokeWidth="2.6" strokeLinecap="round" opacity="0.14" />
    </>
  );
}

function Sleeves({ uid, grad = "g" }: { uid: string; grad?: string }) {
  return (
    <>
      <rect x="15.2" y="26.5" width="7" height="18" rx="3.5" fill={`url(#${uid}-${grad})`} />
      <rect x="41.8" y="26.5" width="7" height="18" rx="3.5" fill={`url(#${uid}-${grad})`} />
    </>
  );
}

function Neck({ skin }: { skin: Duo }) {
  return <rect x="29.6" y="20" width="4.8" height="6.5" rx="1.6" fill={skin[1]} />;
}

/** Hands — in front of the jacket hem (positions overridable for held props). */
function Hands({ uid, left, right }: { uid: string; left?: [number, number]; right?: [number, number] }) {
  const [lx, ly] = left ?? [18.7, 45.6];
  const [rx, ry] = right ?? [45.3, 45.6];
  return (
    <>
      <ellipse cx={lx} cy={ly} rx="3.1" ry="3.4" fill={`url(#${uid}-s)`} />
      <ellipse cx={rx} cy={ry} rx="3.1" ry="3.4" fill={`url(#${uid}-s)`} />
    </>
  );
}

/** A football: white ball with a dark pentagon + patches. */
function Ball({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const w = r * 0.12;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#FBFBF7" stroke="#2E3440" strokeWidth={w} />
      <path
        d={`M${cx - r * 0.42},${cy - r * 0.18} L${cx},${cy - r * 0.64} L${cx + r * 0.42},${cy - r * 0.18} L${cx + r * 0.26},${cy + r * 0.36} L${cx - r * 0.26},${cy + r * 0.36} Z`}
        fill="#2E3440"
      />
      <circle cx={cx - r * 0.78} cy={cy + r * 0.12} r={r * 0.15} fill="#2E3440" />
      <circle cx={cx + r * 0.78} cy={cy + r * 0.12} r={r * 0.15} fill="#2E3440" />
      <circle cx={cx} cy={cy + r * 0.92} r={r * 0.15} fill="#2E3440" />
    </g>
  );
}

/**
 * The same villager eyes, scaled and placed anywhere — objects get the shared
 * DNA (white eye, iris, pupil, glint) so a coin still looks like a villager.
 */
function ToyEyes({ x1, x2, y, iris, s = 1 }: { x1: number; x2: number; y: number; iris: string; s?: number }) {
  return (
    <>
      <ellipse cx={x1} cy={y} rx={2.45 * s} ry={2.75 * s} fill="#FFFDF9" />
      <ellipse cx={x2} cy={y} rx={2.45 * s} ry={2.75 * s} fill="#FFFDF9" />
      <circle cx={x1} cy={y + 0.3 * s} r={1.85 * s} fill={iris} />
      <circle cx={x2} cy={y + 0.3 * s} r={1.85 * s} fill={iris} />
      <circle cx={x1} cy={y + 0.3 * s} r={0.95 * s} fill="#171412" />
      <circle cx={x2} cy={y + 0.3 * s} r={0.95 * s} fill="#171412" />
      <circle cx={x1 - 0.7 * s} cy={y - 0.85 * s} r={0.6 * s} fill="#fff" opacity="0.95" />
      <circle cx={x2 - 0.7 * s} cy={y - 0.85 * s} r={0.6 * s} fill="#fff" opacity="0.95" />
    </>
  );
}

/** The shared villager smile, anywhere. */
function ToySmile({ cx, y, w = 3.6 }: { cx: number; y: number; w?: number }) {
  return (
    <path
      d={`M${cx - w},${y - 0.8} Q${cx},${y + 1.7} ${cx + w},${y - 0.8}`}
      fill="none"
      stroke="#7C4A3C"
      strokeWidth="1.2"
      strokeLinecap="round"
      opacity="0.9"
    />
  );
}

/** Tiny stub legs + shoes — the shared object stance. */
function Stubs({
  legTop = 46,
  legColor = "#3A4557",
  shoe = "#2B2B30",
}: {
  legTop?: number;
  legColor?: string;
  shoe?: string;
}) {
  // Clamp so stub legs never run past the viewBox floor (the shoe hides the
  // join anyway — this just keeps every bbox inside the 64 box).
  const legH = Math.max(0, Math.min(12, 62 - legTop));
  return (
    <>
      <rect x="25.5" y={legTop} width="5.5" height={legH} rx="2.75" fill={legColor} />
      <rect x="33" y={legTop} width="5.5" height={legH} rx="2.75" fill={legColor} />
      <rect x="22.6" y="57.6" width="10" height="4.4" rx="2.2" fill={shoe} />
      <rect x="31.4" y="57.6" width="10" height="4.4" rx="2.2" fill={shoe} />
    </>
  );
}

/** A pair of horizontal stub arms at an object's sides. */
function StubArms({
  y,
  x1,
  x2,
  fill,
  w = 6,
  h = 4.2,
}: {
  y: number;
  x1: number;
  x2: number;
  fill: string;
  w?: number;
  h?: number;
}) {
  return (
    <>
      <rect x={x1} y={y} width={w} height={h} rx={h / 2} fill={fill} />
      <rect x={x2} y={y} width={w} height={h} rx={h / 2} fill={fill} />
    </>
  );
}

// ----------------------------------------------------------------------------
// Archetypes.
// ----------------------------------------------------------------------------

/** Person — the original villager, unchanged. */
function Person({ uid, skin, hair, hairPath, iris, garment, pants, shoe }: ArchParts) {
  return (
    <>
      <Legs uid={uid} pants={pants} shoe={shoe} />
      <Sleeves uid={uid} />
      <Neck skin={skin} />
      <Torso uid={uid} garment={garment} />
      <Hands uid={uid} />
      <Head uid={uid} skin={skin} hair={hair} hairPath={hairPath} iris={iris} />
    </>
  );
}

/** Founder — a person in a suit with a hashed tie (the generic Brands stand-in). */
function Founder({ uid, skin, hair, hairPath, iris, garment, pants, shoe, extra }: ArchParts & { extra: string }) {
  return (
    <>
      <Legs uid={uid} pants={pants} shoe={shoe} />
      <Sleeves uid={uid} />
      <Neck skin={skin} />
      <Torso uid={uid} garment={garment} shirt tie={extra} />
      <Hands uid={uid} />
      <Head uid={uid} skin={skin} hair={hair} hairPath={hairPath} iris={iris} />
    </>
  );
}

/** Footballer — kit jersey, shorts + socks, ball at the feet or under an arm. */
function Footballer({
  uid,
  skin,
  hair,
  hairPath,
  iris,
  shoe,
  kit,
  pose,
}: ArchParts & { kit: Duo; pose: number }) {
  const skinRef = `url(#${uid}-s)`;
  const footOnBall = pose === 0;
  return (
    <>
      {/* Shorts → knees → socks (kit colours); the right leg is shorter when
          the foot rests on the ball. */}
      <rect x="23.5" y="42" width="7" height="9" rx="3" fill={kit[1]} />
      <rect x="23.9" y="50" width="6.2" height="4.6" rx="2.3" fill={skinRef} />
      <rect x="23.9" y="53.8" width="6.2" height="4.6" rx="2.3" fill={kit[0]} />
      <rect x="33.5" y="42" width="7" height="9" rx="3" fill={kit[1]} />
      <rect x="33.9" y="50" width="6.2" height={footOnBall ? 3.4 : 4.6} rx="2.3" fill={skinRef} />
      <rect
        x="33.9"
        y={footOnBall ? 52.6 : 53.8}
        width="6.2"
        height={footOnBall ? 3.2 : 4.6}
        rx="2.3"
        fill={kit[0]}
      />
      <rect x="21.8" y="57.6" width="10.4" height="4.4" rx="2.2" fill={shoe} />
      {footOnBall ? (
        <>
          <Ball cx={37.4} cy={58.2} r={5.2} />
          <rect
            x="31.8"
            y="52.2"
            width="10.4"
            height="4.4"
            rx="2.2"
            fill={shoe}
            transform="rotate(-7 37 54.4)"
          />
        </>
      ) : (
        <rect x="31.8" y="57.6" width="10.4" height="4.4" rx="2.2" fill={shoe} />
      )}
      <rect x="23.1" y="58.3" width="7.2" height="1.3" rx="0.65" fill="#fff" opacity="0.14" />

      {/* Kit jersey (gradient `-k`) + head */}
      <Sleeves uid={uid} grad="k" />
      <Neck skin={skin} />
      <Torso uid={uid} garment={kit} grad="k" />
      {pose === 1 && <Ball cx={48.6} cy={37.6} r={5.4} />}
      <Hands uid={uid} />
      <Head uid={uid} skin={skin} hair={hair} hairPath={hairPath} iris={iris} />
    </>
  );
}

/** Singer — over-ear headphones, sometimes a handheld mic. */
function Singer({
  uid,
  skin,
  hair,
  hairPath,
  iris,
  garment,
  pants,
  shoe,
  extra,
  pose,
}: ArchParts & { extra: string; pose: number }) {
  return (
    <>
      <Legs uid={uid} pants={pants} shoe={shoe} />
      <Sleeves uid={uid} />
      <Neck skin={skin} />
      <Torso uid={uid} garment={garment} />
      {pose === 1 && (
        <>
          {/* Mic, gripped by the right hand */}
          <rect x="46.4" y="33.4" width="3.2" height="8" rx="1.6" fill="#3A4048" />
          <circle cx="48" cy="31.6" r="3.4" fill="#9AA4AE" />
          <path d="M45.6,31 Q48,29 50.4,31" fill="none" stroke="#7C848E" strokeWidth="0.8" />
        </>
      )}
      <Hands uid={uid} />
      <Head uid={uid} skin={skin} hair={hair} hairPath={hairPath} iris={iris} />
      {/* Headphones — band over the hair dome, cups over the ears */}
      <path
        d="M21.6,15.5 C21.6,7 26,3.4 32,3.4 C38,3.4 42.4,7 42.4,15.5"
        fill="none"
        stroke={extra}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <rect x="18.4" y="12.8" width="6.4" height="7.6" rx="3.2" fill={extra} />
      <rect x="39.2" y="12.8" width="6.4" height="7.6" rx="3.2" fill={extra} />
      <rect x="19.8" y="14.6" width="3.6" height="4" rx="1.8" fill="#fff" opacity="0.25" />
    </>
  );
}

/** Coin — an anthropomorphic token with the villager face on its face. */
function Coin({ uid, iris, pants, shoe, extra }: ArchParts & { extra: Duo }) {
  const m = extra;
  return (
    <>
      <Stubs legTop={42} legColor={pants[0]} shoe={shoe} />
      {/* Arms out from the coin's rim */}
      <StubArms y={27} x1={11.4} x2={46.2} fill={m[1]} w={6.4} h={4.8} />
      <circle cx="32" cy="26" r="15.6" fill={`url(#${uid}-c)`} />
      <circle cx="32" cy="26" r="12.6" fill="none" stroke={m[1]} strokeWidth="1.4" opacity="0.55" />
      {/* Milled edge ticks */}
      <path
        d="M32,10.8 V12.6 M32,39.4 V41.2 M17,26 H18.8 M45.2,26 H47"
        stroke={m[1]}
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.7"
      />
      <ToyEyes x1={27.2} x2={36.8} y={23.4} iris={iris} s={0.92} />
      <ToySmile cx={32} y={30.6} w={3.2} />
      <ellipse cx="24.6" cy="28.8" rx="1.7" ry="1" fill="#E2857A" opacity="0.3" />
      <ellipse cx="39.4" cy="28.8" rx="1.7" ry="1" fill="#E2857A" opacity="0.3" />
      <path
        d="M22.8,16.2 L23.6,18.4 L25.8,19.2 L23.6,20 L22.8,22.2 L22,20 L19.8,19.2 L22,18.4 Z"
        fill="#fff"
        opacity="0.55"
      />
    </>
  );
}

/** Bot — antenna, LED visor eyes, panel chest. */
function Bot({ uid, extra }: ArchParts & { extra: string }) {
  const led = extra;
  return (
    <>
      <Stubs legTop={46} legColor="#8FA0B0" shoe="#3A4048" />
      <rect x="12.8" y="30" width="6" height="14" rx="3" fill="#A6B2BE" />
      <rect x="45.2" y="30" width="6" height="14" rx="3" fill="#A6B2BE" />
      {/* Body + chest panel */}
      <rect x="20" y="28.5" width="24" height="18" rx="6" fill="#C3CDD8" />
      <rect x="24" y="32.5" width="16" height="7.5" rx="2" fill="#2A323E" />
      <circle cx="28.5" cy="36.2" r="1.5" fill={led} />
      <circle cx="34" cy="36.2" r="1.5" fill={led} opacity="0.6" />
      <rect x="24" y="41.5" width="16" height="2" rx="1" fill="#8FA0B0" opacity="0.6" />
      {/* Head + visor + antenna */}
      <rect x="27" y="24" width="10" height="5" rx="2" fill="#A6B2BE" />
      <rect x="17" y="7.5" width="30" height="19" rx="8" fill="#C3CDD8" />
      <rect x="21" y="12.5" width="22" height="9.5" rx="4.6" fill="#232A36" />
      <rect x="24.8" y="15.2" width="4.6" height="4.4" rx="2.2" fill={led} />
      <rect x="34.6" y="15.2" width="4.6" height="4.4" rx="2.2" fill={led} />
      <circle cx="26.2" cy="16.4" r="0.7" fill="#fff" opacity="0.8" />
      <circle cx="36" cy="16.4" r="0.7" fill="#fff" opacity="0.8" />
      <path d="M32,7.5 V3.4" stroke="#8FA0B0" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="32" cy="2.4" r="2.2" fill={led} />
      <circle cx="32" cy="2.4" r="1" fill="#fff" opacity="0.75" />
      <rect x="18.5" y="13" width="3" height="6" rx="1.5" fill="#A6B2BE" />
      <rect x="42.5" y="13" width="3" height="6" rx="1.5" fill="#A6B2BE" />
    </>
  );
}

/** Cat — the memes mascot: ears, whiskers, a big laughing mouth (😹). */
function Cat({ uid, iris, shoe, extra }: ArchParts & { extra: Duo }) {
  const fur = extra;
  return (
    <>
      {/* Tail behind the body */}
      <path
        d="M45,46 Q56,44 54.5,35.5 Q53.8,31.5 56.5,30.5"
        fill="none"
        stroke={fur[1]}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <Stubs legTop={47} legColor={fur[1]} shoe={shoe} />
      {/* Body + belly */}
      <rect x="21" y="30" width="22" height="20" rx="9" fill={fur[0]} />
      <ellipse cx="32" cy="42" rx="6.4" ry="7.4" fill="#F7F1E6" opacity="0.85" />
      <StubArms y={36.4} x1={17} x2={41} fill={fur[1]} w={5.4} h={3.6} />
      {/* Ears behind the head, then the head */}
      <path d="M21.5,13 L19.8,4.4 L28,8.6 Z" fill={fur[0]} />
      <path d="M42.5,13 L44.2,4.4 L36,8.6 Z" fill={fur[0]} />
      <path d="M22.6,11.6 L21.8,7 L26.4,9.4 Z" fill="#E8A0A8" opacity="0.85" />
      <path d="M41.4,11.6 L42.2,7 L37.6,9.4 Z" fill="#E8A0A8" opacity="0.85" />
      <circle cx="32" cy="20" r="13" fill={fur[0]} />
      <ToyEyes x1={27.2} x2={36.8} y={17.6} iris={iris} s={0.92} />
      {/* Whiskers */}
      <path
        d="M23.5,20.5 L18.6,19.6 M23.5,22.4 L18.6,23.2 M40.5,20.5 L45.4,19.6 M40.5,22.4 L45.4,23.2"
        stroke={fur[1]}
        strokeWidth="0.8"
        strokeLinecap="round"
        opacity="0.8"
      />
      <ellipse cx="24.8" cy="23.8" rx="1.7" ry="1" fill="#E2857A" opacity="0.35" />
      <ellipse cx="39.2" cy="23.8" rx="1.7" ry="1" fill="#E2857A" opacity="0.35" />
      {/* Nose + the 😹 laugh */}
      <path d="M30.6,21.4 L33.4,21.4 L32,23 Z" fill="#D97B84" />
      <path d="M27.2,24 Q32,30.4 36.8,24 Z" fill="#8C4A3E" />
      <ellipse cx="32" cy="27.6" rx="1.9" ry="1.5" fill="#E2857A" />
      <path d="M28.8,24.4 L30.2,24.4 L29.4,26 Z" fill="#FFFDF9" />
    </>
  );
}

/** Popcorn — the culture bucket: striped carton, kernels, face on the front. */
function Popcorn({ uid, iris, shoe }: ArchParts) {
  return (
    <>
      <Stubs legTop={52} legColor="#B33A3A" shoe={shoe} />
      {/* Kernels crowning the bucket */}
      <circle cx="25.6" cy="30.6" r="4.2" fill="#F7E7B8" stroke="#E2C46F" strokeWidth="0.6" />
      <circle cx="32" cy="27.8" r="4.6" fill="#FBF3D3" stroke="#E2C46F" strokeWidth="0.6" />
      <circle cx="38.6" cy="30.8" r="4" fill="#F7E7B8" stroke="#E2C46F" strokeWidth="0.6" />
      <circle cx="29" cy="33.4" r="3.4" fill="#FBF3D3" stroke="#E2C46F" strokeWidth="0.6" />
      <circle cx="35.6" cy="33.6" r="3.2" fill="#F7E7B8" stroke="#E2C46F" strokeWidth="0.6" />
      {/* Carton */}
      <path d="M23,32 H41 L43.6,53.4 Q32,56.4 20.4,53.4 Z" fill="#F5F1E8" />
      <path d="M26.2,32 L25.2,53.9 L28.6,54.5 L29.6,32 Z" fill="#D64545" />
      <path d="M35.2,32 L36.2,54.5 L39.6,53.9 L38.6,32 Z" fill="#D64545" />
      <path d="M23,32 H41" stroke="#D8D2C4" strokeWidth="1" />
      <StubArms y={40} x1={17.6} x2={41.4} fill="#D64545" w={5} h={3.4} />
      <ToyEyes x1={27.4} x2={36.6} y={42} iris={iris} s={0.92} />
      <ToySmile cx={32} y={48.6} w={3} />
      <ellipse cx="24.8" cy="46.4" rx="1.6" ry="1" fill="#E2857A" opacity="0.3" />
      <ellipse cx="39.2" cy="46.4" rx="1.6" ry="1" fill="#E2857A" opacity="0.3" />
    </>
  );
}

/** Controller — the tech gamepad: grips, d-pad, buttons, face in the middle. */
function Controller({ uid, iris, shoe, extra }: ArchParts & { extra: Duo }) {
  const shell = extra;
  return (
    <>
      <Stubs legTop={45} legColor={shell[1]} shoe={shoe} />
      {/* Grips + shell */}
      <circle cx="15.5" cy="41" r="6" fill={shell[0]} />
      <circle cx="48.5" cy="41" r="6" fill={shell[0]} />
      <rect x="12" y="27" width="40" height="17" rx="8.5" fill={shell[0]} />
      {/* D-pad */}
      <rect x="19.4" y="32.6" width="6" height="2.4" rx="1.2" fill="#232A36" />
      <rect x="21.2" y="30.8" width="2.4" height="6" rx="1.2" fill="#232A36" />
      {/* Buttons */}
      <circle cx="44.6" cy="31.6" r="1.8" fill="#FFD166" />
      <circle cx="47.8" cy="34.8" r="1.8" fill="#7DFCB0" />
      <circle cx="41.4" cy="34.8" r="1.8" fill="#FF8FD1" />
      {/* Face */}
      <ToyEyes x1={28.4} x2={36.4} y={33} iris={iris} s={0.72} />
      <ToySmile cx={32.4} y={38.4} w={2.4} />
    </>
  );
}

/** Car — the Tesla (vehicle brands): windshield, headlight eyes, wheels as feet. */
function Car({ iris, extra }: ArchParts & { extra: Duo }) {
  const body = extra;
  return (
    <>
      {/* Wheels as feet */}
      <rect x="12" y="50" width="10" height="9.5" rx="4" fill="#242A33" />
      <rect x="42" y="50" width="10" height="9.5" rx="4" fill="#242A33" />
      <circle cx="17" cy="54.8" r="2" fill="#8B95A1" />
      <circle cx="47" cy="54.8" r="2" fill="#8B95A1" />
      {/* Roof + windshield */}
      <path d="M19,36 C19,27 24,23 32,23 C40,23 45,27 45,36 Z" fill={body[0]} />
      <path d="M22,35 C22,29 26,26 32,26 C38,26 42,29 42,35 Z" fill="#BFE3F5" opacity="0.9" />
      {/* Body + shaded skirt + bumper */}
      <rect x="9" y="35" width="46" height="17" rx="6" fill={body[0]} />
      <path
        d="M9,46 C16,49 48,49 55,46 L55,46 C55,49.3 52.3,52 49,52 H15 C11.7,52 9,49.3 9,46 Z"
        fill={body[1]}
      />
      <rect x="13" y="48.4" width="38" height="3" rx="1.5" fill="#C9D2DA" opacity="0.5" />
      {/* Headlight eyes + grille smile */}
      <ToyEyes x1={19.6} x2={44.4} y={41.6} iris={iris} s={0.9} />
      <path d="M28.4,47.6 Q32,50 35.6,47.6" fill="none" stroke="#2A303C" strokeWidth="1.6" strokeLinecap="round" />
    </>
  );
}

/** Phone — the Apple (device brand): screen face, notch, home bar. */
function Phone({ iris, shoe }: ArchParts) {
  return (
    <>
      <rect x="21" y="8" width="22" height="45" rx="5.5" fill="#2E3440" />
      <rect x="23" y="11" width="18" height="36" rx="3" fill="#EAF4FB" />
      <rect x="27.8" y="11" width="8.4" height="2.6" rx="1.3" fill="#2E3440" />
      <Stubs legTop={53} legColor="#2E3440" shoe={shoe} />
      <StubArms y={28} x1={17.6} x2={40.4} fill="#2E3440" w={5.2} h={3.6} />
      <ToyEyes x1={27.6} x2={36.4} y={24.4} iris={iris} s={0.86} />
      <ToySmile cx={32} y={31} w={3} />
      <ellipse cx="25.4" cy="29.4" rx="1.5" ry="0.9" fill="#E2857A" opacity="0.3" />
      <ellipse cx="38.6" cy="29.4" rx="1.5" ry="0.9" fill="#E2857A" opacity="0.3" />
      <rect x="27" y="49.4" width="10" height="1.8" rx="0.9" fill="#8B95A1" />
    </>
  );
}

/** Sneaker — the Nike (apparel brand): side profile, laces, wavy stripe. */
function Sneaker({ iris, extra }: ArchParts & { extra: Duo }) {
  const col = extra;
  return (
    <>
      <StubArms y={38} x1={11.5} x2={46.5} fill={col[1]} />
      {/* Upper */}
      <path
        d="M10,50.5 C10,42.5 14.5,37.5 22,37.5 L30,37.5 C36,37.5 42,41.5 48,45.5 C52,48 54,49.6 54,52 L54,53.6 C54,55.7 52.3,57 50,57 L14,57 C11.5,57 10,55.6 10,53.4 Z"
        fill={col[0]}
      />
      {/* Sole + stripe */}
      <rect x="9" y="53.6" width="46" height="5" rx="2.5" fill="#F4F1EA" />
      <path d="M15.5,50.5 Q26,44 41,48.5" fill="none" stroke={col[1]} strokeWidth="2.6" strokeLinecap="round" />
      {/* Laces */}
      <path
        d="M22.5,40.5 L26.5,43.5 M26,39.8 L30,43 M29.5,39.6 L33.5,43"
        stroke="#F4F1EA"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.9"
      />
      <ToyEyes x1={43.6} x2={49.6} y={42.6} iris={iris} s={0.62} />
      <ToySmile cx={46.8} y={46.6} w={2} />
    </>
  );
}

/** Box — the Amazon (logistics brand): kraft carton, tape, face on the front. */
function Box({ iris, shoe }: ArchParts) {
  return (
    <>
      <Stubs legTop={56} legColor="#A87B47" shoe={shoe} />
      {/* Flaps + front */}
      <rect x="13.5" y="26" width="37" height="8" rx="1.5" fill="#D6A86E" />
      <rect x="14" y="33" width="36" height="23" rx="2" fill="#C99A62" />
      <rect x="29" y="26" width="6" height="30" fill="#EBD9B8" opacity="0.85" />
      <path d="M14,33 H50" stroke="#A87B47" strokeWidth="1" />
      <StubArms y={40} x1={9.4} x2={48.6} fill="#A87B47" w={5} h={3.4} />
      <ToyEyes x1={25.8} x2={41.2} y={42} iris={iris} s={0.94} />
      <ToySmile cx={33.5} y={48.8} w={3.4} />
      <ellipse cx="22.4" cy="46.8" rx="1.6" ry="1" fill="#E2857A" opacity="0.3" />
      <ellipse cx="44.6" cy="46.8" rx="1.6" ry="1" fill="#E2857A" opacity="0.3" />
    </>
  );
}

/** Rocket — the SpaceX (aerospace brand): nose cone, fins, hull, flame. */
function Rocket({ iris, extra }: ArchParts & { extra: Duo }) {
  const body = extra;
  return (
    <>
      {/* Fins */}
      <path d="M20,44 C15,47 13,52 12.5,56 L20,52 Z" fill={body[1]} />
      <path d="M44,44 C49,47 51,52 51.5,56 L44,52 Z" fill={body[1]} />
      {/* Flame */}
      <path d="M27.5,53 Q32,62.5 36.5,53 Q34.4,55.6 32,55 Q29.6,55.6 27.5,53 Z" fill="#F0B93E" />
      <path d="M29.8,53.4 Q32,58 34.2,53.4 Q33,55 32,54.8 Q31,55 29.8,53.4 Z" fill="#E2504A" />
      {/* Hull + nose + stripe */}
      <path d="M32,7 C37.5,13 40,22 40,32 V52 H24 V32 C24,22 26.5,13 32,7 Z" fill="#F4F1EA" />
      <path d="M32,7 C37.5,13 40,22 40,32 H32 Z" fill="#DDD7C8" />
      <rect x="24" y="38" width="16" height="4" fill={body[0]} />
      <StubArms y={36} x1={17.4} x2={41.6} fill={body[1]} w={5.4} h={3.6} />
      <ToyEyes x1={28.2} x2={35.8} y={24} iris={iris} s={0.78} />
      <ToySmile cx={32} y={29.4} w={2.4} />
    </>
  );
}

// ----------------------------------------------------------------------------
// The sprite.
// ----------------------------------------------------------------------------

type ArchParts = {
  uid: string;
  id: string;
  skin: Duo;
  hair: Duo;
  hairPath: string;
  iris: string;
  garment: Duo;
  pants: Duo;
  shoe: string;
};

export const CharacterSprite = memo(function CharacterSprite({
  id,
  name,
  category,
  className,
  style,
  character,
}: {
  id: string;
  /** The display name — iconic brands (Tesla, Apple…) render as their object. */
  name?: string;
  /** The handle's PRIMARY category — one character per handle, identical in
   * every district it stands in (never the plot's district). */
  category: CategoryId;
  className?: string;
  style?: CSSProperties;
  /** The handle's saved appearance (on-chain metadata `character`). When its
   *  `look` is present it overrides the hashed skin / hair / style / outfit, so
   *  the user's customisation wins; everything else stays hashed from `id`. */
  character?: HandleCharacter;
}) {
  // Gradient ids must be unique per instance — React's useId, sanitised.
  const uid = `v${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const key = (name ?? "").trim().toLowerCase();
  const look = character?.look;
  const skin = atOr(SKIN, look?.skin) ?? pick(SKIN, id, 11);
  const hair = atOr(HAIR, look?.hair) ?? pick(HAIR, id, 12);
  // A chosen style wins; otherwise female handles get hashed shoulder-length
  // hair (two long styles) and everyone else a hashed short style.
  const hairPath =
    atOr(HAIR_PATHS, look?.style) ??
    (LONG_HAIR.has(key)
      ? (HAIR_LONG_PATHS[Math.floor(hashUnit(id, 19) * HAIR_LONG_PATHS.length)] ?? HAIR_LONG_PATHS[0]!)
      : (HAIR_PATHS[Math.floor(hashUnit(id, 13) * HAIR_PATHS.length)] ?? HAIR_PATHS[0]!));
  const iris = pick(IRIS, id, 14);
  const garment = atOr(GARMENT, look?.outfit) ?? pick(GARMENT, id, 15);
  const pants = pick(PANTS, id, 16);
  const shoe = pick(SHOES, id, 17);

  const kind = archetypeFor(name ?? "", category);
  // Hashed pose variant per archetype (0 / 1): foot-on-ball vs carry, headphones vs mic…
  const pose = hashUnit(id, 18) < 0.5 ? 0 : 1;
  // Identity colours beat the hashed archetype palette (see IDENTITY).
  const identity = IDENTITY[key];
  const kit = identity?.kit ?? pick(KIT, id, 20);
  const coin = identity?.coin ?? pick(COIN, id, 21);
  const led = pick(LED, id, 23);
  const fur = pick(FUR, id, 24);
  const shell = pick(SHELL, id, 25);
  const ride = pick(RIDE, id, 26);
  const tie = pick(KIT, id, 28)[0];

  const parts: ArchParts = { uid, id, skin, hair, hairPath, iris, garment, pants, shoe };
  let figure: ReactNode;
  switch (kind) {
    case "founder":
      figure = <Founder {...parts} extra={tie} />;
      break;
    case "footballer":
      figure = <Footballer {...parts} kit={kit} pose={pose} />;
      break;
    case "singer":
      figure = <Singer {...parts} extra={garment[0]} pose={pose} />;
      break;
    case "coin":
      figure = <Coin {...parts} extra={coin} />;
      break;
    case "bot":
      figure = <Bot {...parts} extra={led} />;
      break;
    case "cat":
      figure = <Cat {...parts} extra={fur} />;
      break;
    case "popcorn":
      figure = <Popcorn {...parts} />;
      break;
    case "controller":
      figure = <Controller {...parts} extra={shell} />;
      break;
    case "car":
      figure = <Car {...parts} extra={ride} />;
      break;
    case "phone":
      figure = <Phone {...parts} />;
      break;
    case "sneaker":
      figure = <Sneaker {...parts} extra={ride} />;
      break;
    case "box":
      figure = <Box {...parts} />;
      break;
    case "rocket":
      figure = <Rocket {...parts} extra={ride} />;
      break;
    default:
      figure = <Person {...parts} />;
  }

  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("world-char__sprite", className)}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`${uid}-s`} cx="35%" cy="26%" r="82%">
          <stop offset="0%" stopColor={skin[0]} />
          <stop offset="100%" stopColor={skin[1]} />
        </radialGradient>
        <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="1" y2="0.7">
          <stop offset="0%" stopColor={garment[0]} />
          <stop offset="100%" stopColor={garment[1]} />
        </linearGradient>
        <linearGradient id={`${uid}-p`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={pants[0]} />
          <stop offset="100%" stopColor={pants[1]} />
        </linearGradient>
        <linearGradient id={`${uid}-k`} x1="0" y1="0" x2="1" y2="0.7">
          <stop offset="0%" stopColor={kit[0]} />
          {/* Jersey shades within its own colour — shorts/collar take kit[1],
              so Messi reads sky-blue + white, Ronaldo green + red. */}
          <stop offset="100%" stopColor={darken(kit[0], 0.22)} />
        </linearGradient>
        <radialGradient id={`${uid}-c`} cx="35%" cy="26%" r="85%">
          <stop offset="0%" stopColor={coin[0]} />
          <stop offset="100%" stopColor={coin[1]} />
        </radialGradient>
      </defs>
      {figure}
    </svg>
  );
});
