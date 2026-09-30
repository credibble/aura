import { useEffect, useRef, useState } from "react";
import jazzicon from "@metamask/jazzicon";
import { artworkOf } from "@/lib/handle-metadata";
import { cn } from "@/lib/utils";

/** Decode a left-aligned ASCII bytes32 handleId ("0x6d65…" → "messi"). */
function decodeBytes32(hex: string): string | null {
  const clean = hex.slice(2);
  if (clean.length !== 64) return null;
  let out = "";
  for (let i = 0; i < 64; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code === 0) break;
    if (code < 0x20 || code > 0x7e) return null; // not printable ASCII
    out += String.fromCharCode(code);
  }
  return out || null;
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic 32-bit seed, normalized so the SAME handle always gets the
 * same face regardless of how it was passed in:
 * - EVM address → MetaMask's own derivation (first 4 bytes) — a wallet keeps
 *   its MetaMask identicon.
 * - bytes32 handleId → decoded to its ASCII label, then hashed.
 * - anything else ("messi", "@messi") → "@" stripped, then hashed.
 */
function seedOf(value: string): number {
  const s = value.trim();
  if (/^0x[0-9a-f]{40}$/i.test(s)) return parseInt(s.slice(2, 10), 16) >>> 0;
  if (/^0x[0-9a-f]{64}$/i.test(s)) {
    const label = decodeBytes32(s.toLowerCase());
    return hash(label ?? s.toLowerCase());
  }
  return hash(s.replace(/^@/, ""));
}

/**
 * The one seed every signed-out / unidentified slot shares, so "you" looks
 * identical in the rail chip, both composers and anywhere else before a wallet
 * or handle is known. Pass it explicitly instead of inventing a local fallback.
 */
export const GUEST_SEED = "guest";

export type AvatarProps = {
  /** Identity seed — wallet address, bytes32 handleId, or label; same seed → same face. */
  seed?: string | null;
  /** Real artwork (handle photo, platform logo) — shown over the identicon. */
  image?: string | null;
  /**
   * Raw on-chain handle metadata (JSON string or object). Parsed HERE, so any
   * call site that has a handle — not just the ones that remembered to map
   * `photo` — still gets the real artwork. `image` wins if both are given.
   */
  metadata?: string | Record<string, unknown> | null;
  imageFit?: "cover" | "contain";
  size?: number;
  alt?: string;
  className?: string;
};

/**
 * THE app avatar — the single source of truth. Every avatar is a rounded
 * square: the handle's REAL artwork when there is one (`image`, or `photo` parsed
 * out of `metadata`), otherwise a deterministic Jazzicon identicon (also the
 * fallback when the image fails to load). The rounded-square shape is applied
 * last so call sites cannot make it round again.
 */
export function Avatar({
  seed,
  image,
  metadata,
  imageFit,
  size = 40,
  alt = "",
  className,
}: AvatarProps) {
  const holder = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);
  // `image` ?? metadata.photo — every avatar tries the URL before the identicon.
  const art = artworkOf(metadata);
  const source = image ?? art.image;
  const fit = imageFit ?? art.imageFit ?? "cover";
  const showImage = Boolean(source) && !failed;

  useEffect(() => {
    if (showImage) return;
    const el = holder.current;
    if (!el) return;
    el.replaceChildren();
    const icon = jazzicon(size, seedOf(seed ?? GUEST_SEED));
    icon.style.transform = "scale(1.35)";
    icon.style.transformOrigin = "center";
    el.appendChild(icon);
    return () => el.replaceChildren();
  }, [seed, size, showImage]);

  // New image source → allow a retry after a previous failure.
  useEffect(() => {
    if (source) setFailed(false);
  }, [source]);

  return (
    <span
      role="img"
      aria-label={alt}
      className={cn(
        // No background of its own: the photo covers the box, and the Jazzicon
        // paints its own shape — a filled tile behind either looks wrong at
        // `contain` fit (logos) and double-paints the identicon. The photo URL
        // always wins; the identicon is only the fallback (no URL / load error).
        "relative inline-grid shrink-0 select-none place-items-center overflow-hidden",
        className,
        // Enforced LAST on purpose: every avatar is a rounded square,
        // regardless of what a call site passes.
        "rounded-[24%]",
      )}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <img
          src={source ?? ""}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className={cn(
            "absolute inset-0 h-full w-full",
            fit === "contain" ? "object-contain" : "object-cover",
          )}
        />
      ) : (
        <span ref={holder} className="grid h-full w-full place-items-center" />
      )}
    </span>
  );
}
