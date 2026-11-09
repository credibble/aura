import { memo, type ReactNode } from "react";
import type { WorldPropData, WorldPropKind } from "@/lib/world-layout";

/** Base edge of a prop's square box, in world units (a villager is 128). */
export const PROP_SIZE = 150;

/**
 * Scenery, drawn in the villagers' flat vector style: a 64×64 box with the
 * base on the bottom line. Muted on purpose — props are set dressing and must
 * never out-shout a market.
 */
const ART: Record<WorldPropKind, ReactNode> = {
  bush: (
    <>
      <ellipse cx="32" cy="55" rx="20" ry="8" fill="#335F43" />
      <circle cx="24" cy="50" r="9" fill="#3A6B4C" />
      <circle cx="38" cy="49" r="11" fill="#3A6B4C" />
      <circle cx="35" cy="45" r="5" fill="#467D5B" opacity="0.8" />
    </>
  ),
  lamp: (
    <>
      <rect x="30.5" y="18" width="3" height="44" rx="1.5" fill="#4A4F55" />
      <rect x="26" y="58" width="12" height="4" rx="2" fill="#3C4045" />
      <circle cx="32" cy="14" r="10" fill="#F4C46A" opacity="0.18" />
      <rect x="26" y="9" width="12" height="10" rx="3" fill="#F4C46A" />
      <rect x="25" y="7" width="14" height="3" rx="1.5" fill="#4A4F55" />
    </>
  ),
  rock: (
    <>
      <path d="M12 62 L18 46 L30 40 L44 44 L52 62 Z" fill="#5E6266" />
      <path d="M18 46 L30 40 L34 50 L22 54 Z" fill="#73777B" />
    </>
  ),
};

/**
 * One prop. Like a villager it counter-rotates out of the tilted plane about
 * its base and follows `--char-scale`, so props and villagers keep the same
 * proportions at every zoom. Not interactive: pointer events fall through.
 */
export const WorldProp = memo(function WorldProp({ prop }: { prop: WorldPropData }) {
  const size = PROP_SIZE * prop.scale;
  return (
    <span
      aria-hidden
      className="world-prop"
      style={{ left: prop.x, top: prop.y, width: size, height: size }}
    >
      <svg viewBox="0 0 64 64" width="100%" height="100%">
        <ellipse cx="32" cy="62" rx="16" ry="3" fill="#000" opacity="0.28" />
        {ART[prop.kind]}
      </svg>
    </span>
  );
});
