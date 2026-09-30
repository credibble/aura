import { emptyProof, windowLabel, type HandleSnapshot } from "@aura/contracts";
import type { AuraHandle } from "../jobs.types";

/** `metadata.photo` (Cloudinary https URL) → HandleSnapshot.image. */
function metadataImage(h: AuraHandle): string | undefined {
  if (!h.metadata) return undefined;
  try {
    const photo = (JSON.parse(h.metadata) as { photo?: unknown }).photo;
    return typeof photo === "string" && photo.startsWith("https://") ? photo : undefined;
  } catch {
    return undefined;
  }
}

/** Map an indexer handle to the frontend HandleSnapshot (aura → index). */
export function handleSnapshot(h: AuraHandle, now = Date.now()): HandleSnapshot {
  const label = windowLabel(h.windowMinutes);
  const image = metadataImage(h);
  return {
    id: h.label,
    symbol: h.label.toUpperCase().slice(0, 4),
    name: h.label,
    category: "culture",
    kind: "entity",
    color: "#8b5cf6",
    ...(image ? { image } : {}),
    index: h.aura / 100,
    change: 0,
    up: 50,
    down: 50,
    velocity: 0,
    shock: 0,
    dominance: 0,
    volume: 0,
    participants: 0,
    history: [],
    spark: [],
    windowShort: label.short,
    windowLong: label.long,
    windowMinutes: h.windowMinutes,
    metric: "aura",
    proof: emptyProof(),
    summary: "",
    drivers: [],
    baseline: h.aura / 100,
    volatility: 0.02,
    ts: now,
  };
}