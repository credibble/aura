export { IndexerClient } from "./client";
export type { IndexerConfig } from "./client";
export { EnvioClient } from "./envio";
export type { EnvioConfig } from "./envio";
export * from "./types";
export * from "./queries";

/** Parse a window metadata JSON string → typed shape (or null). */
export function parseWindowMetadata(json: string): import("./types").WindowMetadata | null {
  try {
    const v = JSON.parse(json) as import("./types").WindowMetadata;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** Parse an OutcomeToken metadata JSON string → typed shape (or null). */
export function parseOutcomeTokenMetadata(json: string): import("./types").OutcomeTokenMetadata | null {
  try {
    const v = JSON.parse(json) as import("./types").OutcomeTokenMetadata;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** Decode a left-aligned bytes32 ASCII handleId → readable label ("btc"). */
export function bytes32ToId(hex: string): string {
  try {
    const clean = hex.replace(/^0x/, "");
    if (clean.length % 2 !== 0) return hex;
    let out = "";
    for (let i = 0; i < clean.length; i += 2) {
      const code = parseInt(clean.slice(i, i + 2), 16);
      if (code === 0) break;
      if (code < 0x20 || code > 0x7e) return hex;
      out += String.fromCharCode(code);
    }
    return out || hex;
  } catch {
    return hex;
  }
}

/** Parse a subgraph BigInt string → number (safe for timestamps/counts). */
export function toNumber(value: string): number {
  return Number(value);
}