import type { HandleSpec } from "@aura/contracts";

/**
 * A handle whitelists the sources allowed to feed it. Sources are independent
 * and interval-driven; the AI worker scores relevance per handle.
 *
 * Handles are created ON-CHAIN (HandleFactory.createHandle) — the oracle does
 * NOT seed them; it reads them from the indexer (GraphQL) and caches them in
 * Redis. Each handle carries its `sources[]` as JSON object strings the
 * platform adapters parse, e.g. `{"platform":"spotify","username":"devar"}`.
 */
export type HandleConfig = HandleSpec & {
  /** Source ids this handle allows — derived from its on-chain `sources[]`. */
  allowedSources: readonly string[];
};

/**
 * The on-chain Handle as indexed by the indexer (one row per HandleCreated).
 * A creator may own many handles; `sources` are the adapter config JSONs.
 */
export interface OnChainHandleView {
  /** bytes32 hex of the handleId. */
  id: string;
  /** Handle contract address. */
  contract: string;
  /** Creator address (every handle has one). */
  owner: string;
  name: string;
  symbol: string;
  metadata: string;
  windowMinutes: bigint;
  sources: string[];
  market: string;
  oracleFactory: string;
  revenue: string;
  stake: string;
  /** Trading-prediction graduation (backend-granted via Handle.setGraduated). */
  graduated: boolean;
  /** On-chain category CODES (1 people · 2 crypto · … · 9 culture). A handle
   *  may carry several; the UI maps each code to a family. */
  categories: number[];
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
      // Printable ASCII only — otherwise this wasn't an ASCII bytes32.
      if (code < 0x20 || code > 0x7e) return hex;
      out += String.fromCharCode(code);
    }
    return out || hex;
  } catch {
    return hex;
  }
}