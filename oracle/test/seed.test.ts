import { describe, expect, it } from "vitest";
import { buildHandleConfigs } from "../src/registry/seed";
import { SOURCES, handleAllowedSources } from "../src/registry/source-seed";

describe("handle universe", () => {
  const configs = buildHandleConfigs();

  it("builds 31 entities + 9 category handles with unique ids", () => {
    const entities = configs.filter((c) => c.kind === "entity");
    const categories = configs.filter((c) => c.kind === "category");
    expect(entities).toHaveLength(31);
    expect(categories).toHaveLength(9);
    expect(new Set(configs.map((c) => c.id)).size).toBe(configs.length);
  });

  it("assigns entity windows from WINDOWS[i % 7]", () => {
    const expected = [15, 30, 60, 120, 240, 480, 1440, 15];
    const first8 = configs
      .filter((c) => c.kind === "entity")
      .slice(0, 8)
      .map((c) => c.windowMinutes);
    expect(first8).toEqual(expected);
  });

  it("assigns the SPECS windows to category handles", () => {
    const byId = new Map(configs.map((c) => [c.id, c]));
    const expected: Record<string, number> = {
      people: 60, crypto: 30, ai: 240, memes: 15, sports: 120,
      brands: 480, music: 60, culture: 1440, tech: 240,
    };
    for (const [id, minutes] of Object.entries(expected)) {
      expect(byId.get(id)?.windowMinutes).toBe(minutes);
    }
  });

  it("whitelists only sources that exist in the source universe", () => {
    const sourceIds = new Set(SOURCES.map((s) => s.id));
    for (const c of configs) {
      expect(c.allowedSources.length).toBeGreaterThan(0);
      for (const sourceId of c.allowedSources) {
        expect(sourceIds.has(sourceId)).toBe(true);
      }
      expect(c.baseline).toBe(50);
    }
  });

  it("source universe has unique ids across all kinds", () => {
    expect(SOURCES.length).toBeGreaterThan(0);
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
    for (const source of SOURCES) {
      expect(source.fetchIntervalMs).toBeGreaterThan(0);
      expect(source.weight).toBeGreaterThan(0);
    }
  });

  it("entity-specific extras are applied", () => {
    expect(handleAllowedSources("crypto", "monad")).toContain("github-monad");
    // X has no free tier → elon's extra is empty (no x-elon feed).
    expect(handleAllowedSources("people", "elon")).not.toContain("x-elon");
  });
});