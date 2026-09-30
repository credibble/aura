import { createHash } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import type { Direction, ProofSignals } from "./domain";

/**
 * The resolution authority's payload. `window.resolved` events carry a complete
 * `WindowResult` (self-contained — no cross-service DB reads) and the market
 * contracts settle from a signed `ResolutionReceipt` derived from it.
 */

/** Fixed-point scale used for every fractional number in the EIP-712 struct. */
export const PRICE_SCALE = 10_000;

export interface WindowResult {
  handleId: string;
  windowStart: number;
  windowEnd: number;
  /** Final absolute sentiment score S_t, 0-100. */
  s: number;
  /** Expectation baseline E_t (priced-in sentiment), 0-100. */
  expectation: number;
  /** Sentiment surprise ΔS_t = S_t - E_t. */
  delta: number;
  /** Bounded index P at window open / close, 0-100. */
  indexOpen: number;
  indexClose: number;
  direction: Direction;
  /** For grouped markets: outcomeId -> dominance share. */
  outcomeDominance?: Record<string, number>;
  itemCount: number;
  proof: ProofSignals;
  resolvedAt: number;
}

/** A `WindowResult` plus its stable identity hash. */
export interface ResolutionReceipt extends WindowResult {
  /** keccak256 over the canonical serialization — the audit/subgraph id. */
  resolutionHash: string;
  /** Present once the oracle has signed the receipt for on-chain submission. */
  signature?: string;
  submittedAt?: number;
}

// ---------------------------------------------------------------------------
// Canonical serialization + stable hash (off-chain identity)
// ---------------------------------------------------------------------------

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(",");
  return `{${body}}`;
}

export function receiptHash(result: WindowResult): string {
  const { resolutionHash: _drop, ...rest } = result as ResolutionReceipt;
  return bytesToHex(keccak_256(canonicalJson(rest)));
}

// ---------------------------------------------------------------------------
// EIP-712 typed data for on-chain signature verification
// ---------------------------------------------------------------------------

export const EIP712_DOMAIN_NAME = "Aura Oracle";
export const EIP712_DOMAIN_VERSION = "1";

export const RESOLUTION_FIELDS = [
  { name: "handleId", type: "bytes32" },
  { name: "windowStart", type: "uint256" },
  { name: "windowEnd", type: "uint256" },
  { name: "s", type: "uint256" },
  { name: "expectation", type: "uint256" },
  { name: "delta", type: "int256" },
  { name: "indexOpen", type: "uint256" },
  { name: "indexClose", type: "uint256" },
  { name: "direction", type: "bool" },
  { name: "itemCount", type: "uint32" },
  { name: "outcomesHash", type: "bytes32" },
  { name: "resolvedAt", type: "uint256" },
] as const;

export const RESOLUTION_TYPE_STRING =
  "ResolutionReceipt(bytes32 handleId,uint256 windowStart,uint256 windowEnd,uint256 s,uint256 expectation,int256 delta,uint256 indexOpen,uint256 indexClose,bool direction,uint32 itemCount,bytes32 outcomesHash,uint256 resolvedAt)";

/**
 * On-chain handle id: the handle's UTF-8, left-aligned in a 32-byte word
 * (matches Solidity `bytes32(bytes(handleId))` and ethers `encodeBytes32String`).
 */
export function handleIdBytes32(handleId: string): Uint8Array {
  const bytes = new TextEncoder().encode(handleId);
  if (bytes.length > 32) throw new Error(`handleId too long for bytes32: ${handleId}`);
  const out = new Uint8Array(32);
  out.set(bytes);
  return out;
}

/** Scaled (fixed-point) fields the contract settles on. */
export interface ScaledResolution {
  handleId: Uint8Array;
  windowStart: bigint;
  windowEnd: bigint;
  s: bigint;
  expectation: bigint;
  delta: bigint;
  indexOpen: bigint;
  indexClose: bigint;
  direction: boolean;
  itemCount: number;
  outcomesHash: Uint8Array;
  resolvedAt: bigint;
}

export function scaleToBigInt(value: number): bigint {
  return BigInt(Math.round(value * PRICE_SCALE));
}

/** Commit to the ordered outcome-dominance list for grouped markets. */
export function outcomesHash(dominance: Record<string, number> | undefined): Uint8Array {
  const entries = Object.entries(dominance ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, share]) => `${id}:${Math.round(share * PRICE_SCALE)}`)
    .join("|");
  return keccak_256(entries);
}

export function toScaledResolution(result: WindowResult): ScaledResolution {
  return {
    handleId: handleIdBytes32(result.handleId),
    windowStart: BigInt(result.windowStart),
    windowEnd: BigInt(result.windowEnd),
    s: scaleToBigInt(result.s),
    expectation: scaleToBigInt(result.expectation),
    delta: scaleToBigInt(result.delta),
    indexOpen: scaleToBigInt(result.indexOpen),
    indexClose: scaleToBigInt(result.indexClose),
    direction: result.direction === "up",
    itemCount: result.itemCount,
    outcomesHash: outcomesHash(result.outcomeDominance),
    resolvedAt: BigInt(result.resolvedAt),
  };
}

// --- ABI packed encoding helpers (the EIP-712 hashStruct scheme) ------------

const U256 = 1n << 256n;

function encodeStringWord(value: string): Uint8Array {
  return keccak_256(new TextEncoder().encode(value));
}

function encodeIntegerWord(value: bigint): Uint8Array {
  const v = value < 0n ? U256 + value : value;
  const out = new Uint8Array(32);
  let x = v;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function encodeBoolWord(value: boolean): Uint8Array {
  return encodeIntegerWord(value ? 1n : 0n);
}

function keccakWords(...words: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const w of words) total += w.length;
  const packed = new Uint8Array(total);
  let offset = 0;
  for (const w of words) {
    packed.set(w, offset);
    offset += w.length;
  }
  return keccak_256(packed);
}

/** The fixed EIP-712 type hash of the ResolutionReceipt struct. */
export function resolutionTypeHash(): Uint8Array {
  return keccak_256(new TextEncoder().encode(RESOLUTION_TYPE_STRING));
}

/** EIP-712 domain separator for the oracle. */
export function domainSeparator(chainId: bigint, verifyingContract: string): Uint8Array {
  const domainTypeHash = keccak_256(
    new TextEncoder().encode(
      "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
    ),
  );
  const nameHash = encodeStringWord(EIP712_DOMAIN_NAME);
  const versionHash = encodeStringWord(EIP712_DOMAIN_VERSION);
  const chainWord = encodeIntegerWord(chainId);
  const verifyingWord = encodeStringWord(verifyingContract.toLowerCase());
  return keccakWords(domainTypeHash, nameHash, versionHash, chainWord, verifyingWord);
}

/** EIP-712 hashStruct of the scaled resolution. */
export function hashStruct(r: ScaledResolution): Uint8Array {
  return keccakWords(
    resolutionTypeHash(),
    r.handleId, // bytes32 — encoded as the raw 32-byte word
    encodeIntegerWord(r.windowStart),
    encodeIntegerWord(r.windowEnd),
    encodeIntegerWord(r.s),
    encodeIntegerWord(r.expectation),
    encodeIntegerWord(r.delta),
    encodeIntegerWord(r.indexOpen),
    encodeIntegerWord(r.indexClose),
    encodeBoolWord(r.direction),
    encodeIntegerWord(BigInt(r.itemCount)),
    r.outcomesHash,
    encodeIntegerWord(r.resolvedAt),
  );
}

/** The EIP-712 digest the oracle signs and the contract recovers via ecrecover. */
export function eip712Digest(chainId: bigint, verifyingContract: string, result: WindowResult): Uint8Array {
  const prefix = new Uint8Array([0x19, 0x01]);
  return keccak_256(
    keccakWords(prefix, domainSeparator(chainId, verifyingContract), hashStruct(toScaledResolution(result))),
  );
}

/** SHA-256 of the canonical payload — a secondary, cheap audit id. */
export function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function hex(bytes: Uint8Array): string {
  return `0x${bytesToHex(bytes)}`;
}