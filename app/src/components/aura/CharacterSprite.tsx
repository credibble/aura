import { memo, useId, type CSSProperties } from "react";
import { hashUnit } from "@/lib/world-layout";
import { cn } from "@/lib/utils";

/**
 * The villager. Drawn as a 64×64 vector character — shaded skin, a real face
 * (brows, lidded eyes with iris + glint, nose, smile, blush), one of three
 * hairstyles, a zippered jacket, hands, pants and shoes. Skin, hair colour and
 * style, iris, jacket and pants are all hashed from the handle id, so every
 * handle keeps the same person everywhere on the map — no sprite files, no
 * avatars, and it stays crisp at any zoom.
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

/** Fringe shapes, all sharing the same dome over the head. */
const HAIR_PATHS = [
  // Wavy — soft locks breaking across the forehead.
  "M22.4,14.6 C22.4,6.2 26.6,3 32,3 C37.4,3 41.6,6.2 41.6,14.6 C41,12.2 38.9,11.4 36.4,12.2 C34,13 31.7,12.2 29.2,11.8 C26.6,11.4 23.6,12 22.4,14.6 Z",
  // Bowl — an even fringe across the brow.
  "M22.4,14.6 C22.4,6.2 26.6,3 32,3 C37.4,3 41.6,6.2 41.6,14.6 L41.6,11.7 C40.2,11 36.4,10.6 32,10.6 C27.6,10.6 23.8,11 22.4,11.7 Z",
  // Spiky — tips over the dome.
  "M22.4,14.6 C22.4,6.2 26.6,3 32,3 C37.4,3 41.6,6.2 41.6,14.6 L41.6,11.6 L38.8,8.8 L36.4,11.8 L32.4,8.4 L29.6,11.8 L26,9 L22.4,11.8 Z",
] as const;

function pick<T>(palette: readonly T[], id: string, salt: number): T {
  return palette[Math.floor(hashUnit(id, salt) * palette.length)] ?? palette[0]!;
}

export const CharacterSprite = memo(function CharacterSprite({
  id,
  className,
  style,
}: {
  id: string;
  className?: string;
  style?: CSSProperties;
}) {
  // Gradient ids must be unique per instance — React's useId, sanitised.
  const uid = `v${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const skin = pick(SKIN, id, 11);
  const hair = pick(HAIR, id, 12);
  const hairPath = HAIR_PATHS[Math.floor(hashUnit(id, 13) * HAIR_PATHS.length)] ?? HAIR_PATHS[0];
  const iris = pick(IRIS, id, 14);
  const garment = pick(GARMENT, id, 15);
  const pants = pick(PANTS, id, 16);
  const shoe = pick(SHOES, id, 17);

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
      </defs>

      {/* Legs + shoes */}
      <rect x="23.5" y="42" width="7" height="17.6" rx="3" fill={`url(#${uid}-p)`} />
      <rect x="33.5" y="42" width="7" height="17.6" rx="3" fill={`url(#${uid}-p)`} />
      <rect x="21.8" y="57.6" width="10.4" height="4.4" rx="2.2" fill={shoe} />
      <rect x="31.8" y="57.6" width="10.4" height="4.4" rx="2.2" fill={shoe} />
      <rect x="23.1" y="58.3" width="7.2" height="1.3" rx="0.65" fill="#fff" opacity="0.14" />
      <rect x="33.1" y="58.3" width="7.2" height="1.3" rx="0.65" fill="#fff" opacity="0.14" />

      {/* Sleeves (behind the jacket body) */}
      <rect x="15.2" y="26.5" width="7" height="18" rx="3.5" fill={`url(#${uid}-g)`} />
      <rect x="41.8" y="26.5" width="7" height="18" rx="3.5" fill={`url(#${uid}-g)`} />

      {/* Neck (behind head and collar) */}
      <rect x="29.6" y="20" width="4.8" height="6.5" rx="1.6" fill={skin[1]} />

      {/* Torso — shoulders, collar seam, zipper, hem */}
      <path
        d="M26,23 H38 C42,23 45,26.2 45,30.2 V44.6 C45,46.2 43.8,47.4 42.2,47.4 H21.8 C20.2,47.4 19,46.2 19,44.6 V30.2 C19,26.2 22,23 26,23 Z"
        fill={`url(#${uid}-g)`}
      />
      <path
        d="M29.4,23.4 L32,28.8 L34.6,23.4"
        fill="none"
        stroke={garment[1]}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M32,28.8 V47.3" stroke={garment[1]} strokeWidth="1" opacity="0.55" />
      <path d="M19.8,45.4 H44.2" stroke={garment[1]} strokeWidth="1.6" opacity="0.5" />
      {/* Jacket shadow falling on the pants */}
      <path
        d="M24,48.5 H40"
        stroke="#000"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.14"
      />

      {/* Hands — in front of the jacket hem */}
      <ellipse cx="18.7" cy="45.6" rx="3.1" ry="3.4" fill={`url(#${uid}-s)`} />
      <ellipse cx="45.3" cy="45.6" rx="3.1" ry="3.4" fill={`url(#${uid}-s)`} />

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

      {/* Face — blush, brows, lidded eyes, nose, smile */}
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
    </svg>
  );
});
