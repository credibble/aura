import { describe, it, expect } from "vitest";
import {
  parseHandleMeta,
  decodeHandleId,
  mergeUserMetadata,
  userMetadataPatch,
  planSync,
  type SubgraphHandleMeta,
} from "../src/registry/handle-metadata-sync";

/**
 * The subgraph → Postgres metadata sync. Regression coverage for the bug it
 * fixes: a renamed handle (or a new photo) updated on-chain and in the subgraph
 * while the PG-backed comment/feed rows kept the stale value forever.
 */

/** "elon" left-padded into a bytes32 handleId, as the chain stores it. */
const ID_ELON = `0x${Buffer.from("elon", "utf8").toString("hex").padEnd(64, "0")}`;
const OWNER = "0xC0Ffb5dF60843E8cb1647F651062aFA3e494dd7a";

const row = (over: Partial<SubgraphHandleMeta> = {}): SubgraphHandleMeta => ({
  id: ID_ELON,
  name: "Elon Musk",
  symbol: "ELON",
  metadata: JSON.stringify({ name: "Elon Musk", symbol: "ELON", photo: "https://cdn/x.jpg", imageFit: "cover" }),
  owner: { id: OWNER },
  categoryIds: ["people", "tech"],
  ...over,
});

describe("decodeHandleId", () => {
  it("decodes the ASCII label out of a bytes32 id", () => {
    expect(decodeHandleId(ID_ELON)).toBe("elon");
    expect(decodeHandleId(`${ID_ELON}`.toUpperCase().replace("0X", "0x"))).toBe("elon");
  });
  it("returns the input unchanged when it is not printable ASCII", () => {
    expect(decodeHandleId(`0x${"ff".repeat(32)}`)).toBe(`0x${"ff".repeat(32)}`);
  });
});

describe("parseHandleMeta", () => {
  it("parses identity + metadata JSON, deduping categories", () => {
    const p = parseHandleMeta(row({ categoryIds: ["people", "tech", "people"] }));
    expect(p).not.toBeNull();
    expect(p!.userId).toBe(OWNER.toLowerCase());
    expect(p!.name).toBe("Elon Musk");
    expect(p!.photo).toBe("https://cdn/x.jpg");
    expect(p!.imageFit).toBe("cover");
    expect(p!.categories).toEqual(["people", "tech"]); // deduped, order kept
  });

  it("falls back to the identity fields when the metadata blob is malformed", () => {
    const p = parseHandleMeta(row({ metadata: "{not json" }));
    expect(p!.name).toBe("Elon Musk");
    expect(p!.photo).toBeUndefined();
    expect(p!.imageFit).toBeUndefined();
  });

  it("falls back to the decoded label when there is no name at all", () => {
    const p = parseHandleMeta(row({ name: null, metadata: null }));
    expect(p!.name).toBe("elon"); // decoded from the handleId
    expect(p!.symbol).toBe("ELON"); // identity field kept
  });

  it("rejects rows with a bad id or a missing owner (no PG row to write)", () => {
    expect(parseHandleMeta(row({ id: "0x1234" }))).toBeNull();
    expect(parseHandleMeta(row({ owner: null }))).toBeNull();
    expect(parseHandleMeta(row({ owner: { id: "not-an-address" } }))).toBeNull();
  });
});

describe("mergeUserMetadata", () => {
  it("patches handle fields without clobbering unrelated profile keys", () => {
    const before = { bio: "gm", links: ["https://x.com/elon"], name: "old" };
    const after = mergeUserMetadata(before, userMetadataPatch(parseHandleMeta(row())!));
    expect(after.bio).toBe("gm");
    expect(after.links).toEqual(["https://x.com/elon"]);
    expect(after.name).toBe("Elon Musk"); // ours wins
    expect(after.handle).toBe("@elon");
    expect(after.categories).toEqual(["people", "tech"]);
    expect(typeof after.syncedAt).toBe("string");
  });

  it("tolerates a null/non-object existing blob", () => {
    const after = mergeUserMetadata(null, { name: "x" });
    expect(after.name).toBe("x");
  });
});

describe("planSync", () => {
  it("plans a create for an owner with no PG row, an update when it drifted, and skips in-sync rows", () => {
    const inSync = userMetadataPatch(parseHandleMeta(row())!);
    const existing = new Map<string, unknown>([
      // a stale row: photo changed on-chain, PG still has the old one
      ["0x1111111111111111111111111111111111111111", { name: "Old", photo: "old.jpg" }],
      // already in sync (syncedAt is ignored in the comparison)
      [OWNER.toLowerCase(), inSync],
    ]);

    const plans = planSync(
      [
        row({ id: ID_ELON }), // in sync → unchanged
        row({ id: `0x${Buffer.from("ronaldo", "utf8").toString("hex").padEnd(64, "0")}`, owner: { id: "0x1111111111111111111111111111111111111111" } }),
        row({ id: `0x${Buffer.from("btc", "utf8").toString("hex").padEnd(64, "0")}`, owner: { id: "0x2222222222222222222222222222222222222222" } }),
      ],
      existing,
    );

    const byAction = plans.reduce<Record<string, string[]>>((acc, p) => {
      (acc[p.action] ??= []).push(p.label);
      return acc;
    }, {});
    expect(byAction.unchanged).toEqual(["elon"]);
    expect(byAction.update).toEqual(["ronaldo"]);
    expect(byAction.create).toEqual(["btc"]);
  });

  it("keeps one plan per owner (the newest handle wins) and drops invalid rows", () => {
    const plans = planSync(
      [
        row({ id: `0x${Buffer.from("a", "utf8").toString("hex").padEnd(64, "0")}` }),
        row({ id: `0x${Buffer.from("b", "utf8").toString("hex").padEnd(64, "0")}` }), // same owner
        row({ id: "0xdead", owner: { id: OWNER } }), // invalid id
      ],
      new Map(),
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]!.action).toBe("create");
  });
});
