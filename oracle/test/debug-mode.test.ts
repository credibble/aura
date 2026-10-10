import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import {
  KimiAiModel,
  type AiFetch,
  type SourceGroup,
} from "../src/adapters/ai/llm/kimi-ai.model";
import { StructuredAiService } from "../src/jobs/ai/structured-ai.service";
import { KimiWebSearchService } from "../src/jobs/ai/kimi-web-search.service";
import { isDebugMode, sampleAuraPercent } from "../src/config/debug";
import { validateEnv } from "../src/config/env";

/**
 * DEBUG_MODE is a hard offline switch: with it on, NO AI entry point may make a
 * network request — the aura scorer, the structured completion service and the
 * web-search tool all short-circuit to a marked random/sample response.
 *
 * Every test injects a fetch that throws if invoked, so "no provider call" is
 * proven rather than assumed.
 */

function config(overrides: Record<string, unknown> = {}): ConfigService {
  return { get: (key: string) => overrides[key] } as ConfigService;
}

function groups(overrides: Partial<SourceGroup> = {}): SourceGroup[] {
  return [
    {
      label: "FOX Sports",
      reliability: 860,
      items: ["Ronaldo scores twice and breaks a record"],
      context: "Analyse ronaldo",
      ...overrides,
    },
  ];
}

/** A fetch stub that fails the test if the provider is ever contacted. */
function neverFetch(): AiFetch {
  return vi.fn(async () => {
    throw new Error("AI fetch must not be called in DEBUG_MODE");
  }) as unknown as AiFetch;
}

const originalDebug = process.env.DEBUG_MODE;

afterEach(() => {
  if (originalDebug === undefined) delete process.env.DEBUG_MODE;
  else process.env.DEBUG_MODE = originalDebug;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DEBUG_MODE — the AI provider is never called", () => {
  it("env schema: DEBUG_MODE defaults to false and parses the string form", () => {
    expect(validateEnv({}).DEBUG_MODE).toBe(false);
    expect(validateEnv({ DEBUG_MODE: "true" }).DEBUG_MODE).toBe(true);
    expect(validateEnv({ DEBUG_MODE: "false" }).DEBUG_MODE).toBe(false);
    expect(validateEnv({ DEBUG_MODE: "1" }).DEBUG_MODE).toBe(false);
  });

  it("isDebugMode() reflects process.env", () => {
    delete process.env.DEBUG_MODE;
    expect(isDebugMode()).toBe(false);
    process.env.DEBUG_MODE = "true";
    expect(isDebugMode()).toBe(true);
  });

  it("sampleAuraPercent() stays inside the ±5–20 band, one decimal", () => {
    for (let i = 0; i < 200; i++) {
      const p = sampleAuraPercent();
      expect(Math.abs(p)).toBeGreaterThanOrEqual(5);
      expect(Math.abs(p)).toBeLessThanOrEqual(20);
      expect(Math.round(p * 10) / 10).toBe(p);
    }
  });

  it("interpret(): random in-band percent, one fetch short of the provider", async () => {
    process.env.DEBUG_MODE = "true";
    const fetchFn = neverFetch();
    const model = new KimiAiModel(config({ KIMI_API_KEY: "sk-test" }), fetchFn);

    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const percent = await model.interpret("ronaldo", groups());
      expect(Number.isFinite(percent)).toBe(true);
      expect(Math.abs(percent)).toBeGreaterThanOrEqual(5);
      expect(Math.abs(percent)).toBeLessThanOrEqual(20);
      seen.add(percent);
    }
    // 30 draws in a 151-step band are effectively never all identical.
    expect(seen.size).toBeGreaterThan(1);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("scoreWithSummary(): marked sample memo, no provider call", async () => {
    process.env.DEBUG_MODE = "true";
    const fetchFn = neverFetch();
    const model = new KimiAiModel(config({ KIMI_API_KEY: "sk-test" }), fetchFn);

    const { percent, summary } = await model.scoreWithSummary("ronaldo", groups());
    expect(Math.abs(percent)).toBeGreaterThanOrEqual(5);
    expect(Math.abs(percent)).toBeLessThanOrEqual(20);
    expect(summary).toMatch(/^\[debug\] sampled [+-]\d+(\.\d+)?% \(no AI call\)$/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("StructuredAiService: complete/completeJson short-circuit to a sample", async () => {
    process.env.DEBUG_MODE = "true";
    const fetchFn = neverFetch();
    const ai = new StructuredAiService(config({ KIMI_API_KEY: "sk-test" }), fetchFn);

    const text = await ai.complete("system", "user");
    expect(text).toContain("[debug]");

    const fallback = { title: "fallback", change: 3 };
    const json = await ai.completeJson("system", "user", fallback);
    expect(json).toEqual({ title: "fallback", change: 3, debug: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("KimiWebSearchService.search(): no network, marked sample result", async () => {
    process.env.DEBUG_MODE = "true";
    const globalFetch = vi.fn(async () => {
      throw new Error("network must not be used in DEBUG_MODE");
    });
    vi.stubGlobal("fetch", globalFetch);

    const search = new KimiWebSearchService(config({ MOONSHOT_API_KEY: "sk-test" }));
    const results = await search.search("ronaldo");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.title).toContain("[debug]");
    expect(results[0]!.snippet).toContain("no web search");
    expect(globalFetch).not.toHaveBeenCalled();
  });
});

describe("DEBUG_MODE=false — the real path is unchanged", () => {
  it("KimiAiModel calls the provider and parses its answer", async () => {
    delete process.env.DEBUG_MODE;
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { role: "assistant", content: '{"percent": 7.5, "summary": "real"}' } }],
      }),
      text: async () => "",
    })) as unknown as AiFetch;

    const model = new KimiAiModel(config({ KIMI_API_KEY: "sk-test" }), fetchFn);
    await expect(model.scoreWithSummary("ronaldo", groups())).resolves.toEqual({
      percent: 7.5,
      summary: "real",
    });
    // Two completions on the real JSON path: the answer pass, then the
    // response_format re-ask (see KimiAiModel.run).
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("StructuredAiService calls the provider", async () => {
    delete process.env.DEBUG_MODE;
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "hello there" } }] }),
      text: async () => "",
    })) as unknown as AiFetch;

    const ai = new StructuredAiService(config({ KIMI_API_KEY: "sk-test" }), fetchFn);
    await expect(ai.complete("s", "u")).resolves.toBe("hello there");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("KimiWebSearchService hits the global fetch", async () => {
    delete process.env.DEBUG_MODE;
    const globalFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ search_results: [{ title: "t", url: "u", snippet: "s" }] }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", globalFetch);

    const search = new KimiWebSearchService(config({ MOONSHOT_API_KEY: "sk-test" }));
    await expect(search.search("ronaldo")).resolves.toEqual([{ title: "t", url: "u", snippet: "s" }]);
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });
});
