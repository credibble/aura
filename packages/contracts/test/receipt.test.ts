import { describe, expect, it } from "vitest";
import {
  PRICE_SCALE,
  canonicalJson,
  domainSeparator,
  eip712Digest,
  hex,
  outcomesHash,
  receiptHash,
  resolutionTypeHash,
  scaleToBigInt,
  toScaledResolution,
} from "../src/receipt";
import type { WindowResult } from "../src/receipt";

const sample: WindowResult = {
  handleId: "btc",
  windowStart: 1_777_000_000_000,
  windowEnd: 1_777_000_900_000,
  s: 72.5,
  expectation: 68.25,
  delta: 4.25,
  indexOpen: 64.1,
  indexClose: 68.35,
  direction: "up",
  outcomeDominance: { btc: 61, eth: 23, sol: 16 },
  itemCount: 142,
  proof: { social: 71, community: 66, media: 74, search: 69 },
  resolvedAt: 1_777_000_900_050,
};

describe("canonicalJson", () => {
  it("is deterministic regardless of key order", () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe("receiptHash", () => {
  it("is a stable keccak hex over the canonical payload", () => {
    const h1 = receiptHash(sample);
    const h2 = receiptHash({ ...sample, resolvedAt: sample.resolvedAt + 1 });
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(h2);
  });
});

describe("outcomesHash", () => {
  it("is order-independent and stable", () => {
    expect(outcomesHash({ a: 40, b: 60 })).toEqual(outcomesHash({ b: 60, a: 40 }));
    expect(outcomesHash(undefined).length).toBe(32);
  });
});

describe("scaling", () => {
  it("round-trips fixed point", () => {
    expect(scaleToBigInt(72.5)).toBe(725_000n);
    expect(scaleToBigInt(-4.25)).toBe(-42_500n);
    const scaled = toScaledResolution(sample);
    expect(scaled.s).toBe(725_000n);
    expect(scaled.delta).toBe(42_500n);
    expect(scaled.itemCount).toBe(142);
    expect(scaled.direction).toBe(true);
  });
});

describe("EIP-712", () => {
  it("produces a 32-byte domain separator", () => {
    const ds = domainSeparator(10_143n, "0x1111111111111111111111111111111111111111");
    expect(ds.length).toBe(32);
  });

  it("produces a stable 32-byte digest", () => {
    const d1 = eip712Digest(10_143n, "0x1111111111111111111111111111111111111111", sample);
    const d2 = eip712Digest(10_143n, "0x1111111111111111111111111111111111111111", sample);
    expect(d1).toEqual(d2);
    expect(d1.length).toBe(32);
    expect(hex(d1)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(resolutionTypeHash().length).toBe(32);
  });

  it("differs when chainId or a field changes", () => {
    const base = eip712Digest(10_143n, "0x1111111111111111111111111111111111111111", sample);
    const otherChain = eip712Digest(1n, "0x1111111111111111111111111111111111111111", sample);
    const otherDelta = eip712Digest(10_143n, "0x1111111111111111111111111111111111111111", {
      ...sample,
      delta: -4.25,
    });
    expect(base).not.toEqual(otherChain);
    expect(base).not.toEqual(otherDelta);
  });
});

describe("PRICE_SCALE", () => {
  it("keeps four decimals of precision", () => {
    expect(PRICE_SCALE).toBe(10_000);
  });
});