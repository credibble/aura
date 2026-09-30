import { describe, expect, it } from "vitest";
import { bytes32ToId } from "../src/core/domain/handle";
import { handleDefaultMeta } from "../src/registry/seed";
import { AdapterRegistry } from "../src/adapters/adapter-registry.service";

/** Encode a left-aligned ASCII handleId the same way the chain does. */
function encodeBytes32(s: string): string {
  return "0x" + Buffer.from(s, "utf8").toString("hex").padEnd(64, "0");
}

describe("On-chain handle decoding (bytes32 → id)", () => {
  it("decodes a left-aligned bytes32 ASCII handleId", () => {
    expect(bytes32ToId(encodeBytes32("btc"))).toBe("btc");
    expect(bytes32ToId(encodeBytes32("taylorswift"))).toBe("taylorswift");
    expect(bytes32ToId("0x0000000000000000000000000000000000000000000000000000000000000000")).toBe("0x0000000000000000000000000000000000000000000000000000000000000000");
  });

  it("is idempotent for already-readable ids", () => {
    expect(bytes32ToId("abc")).toBe("abc");
  });
});

describe("Handle metadata defaults (display only — not seeding)", () => {
  it("provides display defaults for known demo handles", () => {
    const meta = handleDefaultMeta("btc");
    expect(meta.category).toBe("crypto");
    expect(meta.windowMinutes).toBeGreaterThan(0);
    expect(typeof meta.volatility).toBe("number");
  });

  it("returns {} for unknown handles (handles still come from the subgraph)", () => {
    expect(handleDefaultMeta("some-new-onchain-handle")).toEqual({});
  });
});

describe("On-chain sources → adapter source ids", () => {
  const registry = new AdapterRegistry();

  it("maps a handle's on-chain sources[] JSON configs to source ids", () => {
    const sources = registry.buildFromJsonStrings([
      JSON.stringify({ platform: "spotify", variant: "profile", username: "@dev" }),
      JSON.stringify({ platform: "rss", outlet: "bbc", feed: "https://feeds.bbci.co.uk/news/rss.xml" }),
    ]);
    expect(sources.map((s) => s.id)).toEqual(["spotify-@dev", "rss-bbc"]);
  });

  it("ignores configs with unknown platforms", () => {
    expect(registry.buildFromJsonStrings([JSON.stringify({ platform: "tiktok" })])).toHaveLength(0);
  });
});