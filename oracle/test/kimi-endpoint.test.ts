import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { resolveKimiEndpoint } from "../src/adapters/ai/llm/kimi-endpoint";
import { KimiAiModel, type AiFetch, type SourceGroup } from "../src/adapters/ai/llm/kimi-ai.model";

function config(overrides: Record<string, unknown> = {}): ConfigService {
  return { get: (key: string) => overrides[key] } as ConfigService;
}

const groups: SourceGroup[] = [
  { label: "FOX Sports", reliability: 860, items: ["Ronaldo scores twice"] },
];

describe("KIMI_VIA_0G — one flag flips the whole AI layer's endpoint", () => {
  it("defaults to Moonshot", () => {
    expect(resolveKimiEndpoint(config({ KIMI_API_KEY: "mk" }))).toEqual({
      apiKey: "mk",
      model: "kimi-k2.6",
      baseUrl: "https://api.moonshot.ai/v1",
      viaZeroG: false,
      keyName: "KIMI_API_KEY",
    });
  });

  it("routes to 0G with its own key/model when on", () => {
    const ep = resolveKimiEndpoint(
      config({ KIMI_VIA_0G: true, ZERO_G_API_KEY: "gk" }),
    );
    expect(ep).toEqual({
      apiKey: "gk",
      model: "kimi-k2.5",
      baseUrl: "https://router-api.0g.ai/v1",
      viaZeroG: true,
      keyName: "ZERO_G_API_KEY",
    });
    // Accepts the string form too (env values arrive as strings).
    expect(resolveKimiEndpoint(config({ KIMI_VIA_0G: "true" })).viaZeroG).toBe(true);
    expect(resolveKimiEndpoint(config({ KIMI_VIA_0G: "false" })).viaZeroG).toBe(false);
  });

  it("does not fall back to the Moonshot key — fails closed without ZERO_G_API_KEY", () => {
    const ep = resolveKimiEndpoint(config({ KIMI_VIA_0G: true, KIMI_API_KEY: "mk" }));
    expect(ep.apiKey).toBeUndefined();
    expect(ep.keyName).toBe("ZERO_G_API_KEY");
  });

  it("sends the actual request to the 0G router when enabled", async () => {
    const seen: string[] = [];
    const fetchFn: AiFetch = vi.fn(async (url: string) => {
      seen.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { role: "assistant", content: "+7.5" } }] }),
        text: async () => "",
      } as unknown as Response;
    });
    const model = new KimiAiModel(
      config({ KIMI_VIA_0G: true, ZERO_G_API_KEY: "gk", ZERO_G_MODEL: "kimi-k2.5" }),
      fetchFn,
    );
    await model.interpret("ronaldo", groups);
    expect(seen).toEqual(["https://router-api.0g.ai/v1/chat/completions"]);
  });
});
