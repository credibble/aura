import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { KimiAiModel, type AiFetch, type SourceGroup } from "../src/adapters/ai/llm/kimi-ai.model";
import { KimiWebSearchService } from "../src/jobs/ai/kimi-web-search.service";

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

function stubFetch(...contents: string[]): AiFetch {
  let i = 0;
  return vi.fn(async () => {
    const content = contents[Math.min(i, contents.length - 1)]!;
    i += 1;
    // Accept either a full chat-completions payload or a bare content string.
    let payload: unknown;
    try {
      const parsed = JSON.parse(content);
      payload = typeof parsed === "object" && parsed !== null ? parsed : { choices: [{ message: { role: "assistant", content } }] };
    } catch {
      payload = { choices: [{ message: { role: "assistant", content } }] };
    }
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => content,
    } as unknown as Response;
  });
}

describe("KimiAiModel — aura oracle (integer-only delta, one handle at a time)", () => {
  it("returns the model's signed aura delta from grouped sources", async () => {
    const model = new KimiAiModel(config({ KIMI_API_KEY: "sk-test" }), stubFetch("+3"));
    expect(await model.interpret("ronaldo", groups())).toBe(3);
  });

  it("parses negative and zero deltas", async () => {
    const neg = new KimiAiModel(config({ KIMI_API_KEY: "sk-test" }), stubFetch("-2"));
    expect(await neg.interpret("ronaldo", groups())).toBe(-2);
    const zero = new KimiAiModel(config({ KIMI_API_KEY: "sk-test" }), stubFetch("0"));
    expect(await zero.interpret("ronaldo", groups())).toBe(0);
  });

  it("parses one-decimal percents (the contract is a signed percent, ±20)", async () => {
    const small = new KimiAiModel(config({ KIMI_API_KEY: "sk-test" }), stubFetch("+6.3"));
    expect(await small.interpret("ronaldo", groups())).toBe(6.3);
    const big = new KimiAiModel(config({ KIMI_API_KEY: "sk-test" }), stubFetch("12.2"));
    expect(await big.interpret("ronaldo", groups())).toBe(12.2);
    const neg = new KimiAiModel(config({ KIMI_API_KEY: "sk-test" }), stubFetch("-7.4"));
    expect(await neg.interpret("ronaldo", groups())).toBe(-7.4);
    // Sub-0.1 magnitudes round to 0 here; the ENGINE applies the ±5% floor.
    const dust = new KimiAiModel(config({ KIMI_API_KEY: "sk-test" }), stubFetch("+0.03"));
    expect(await dust.interpret("ronaldo", groups())).toBe(0);
  });

  it("clamps absurd deltas and tolerates whitespace", async () => {
    const model = new KimiAiModel(config({ KIMI_API_KEY: "sk-test" }), stubFetch("  +5000  "));
    expect(await model.interpret("ronaldo", groups())).toBe(20); // ±20.00 display cap
  });

  it("returns neutral 0 when unconfigured or there are no sources", async () => {
    const model = new KimiAiModel(config({}), stubFetch("999"));
    expect(await model.interpret("ronaldo", groups())).toBe(0);
    const empty = new KimiAiModel(config({ KIMI_API_KEY: "sk-test" }), stubFetch("5"));
    expect(await empty.interpret("ronaldo", [])).toBe(0);
  });

  it("calls the web_search tool, feeds results back, then returns the delta", async () => {
    const webSearch = {
      enabled: true,
      search: vi.fn(async (q: string) => [{ title: "Ronaldo news", url: "https://x", snippet: `about ${q}` }]),
    } as unknown as KimiWebSearchService;
    // Pass 1: the model requests the tool; pass 2: it replies with the integer.
    const model = new KimiAiModel(
      config({ KIMI_API_KEY: "sk-test" }),
      stubFetch(
        JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              tool_calls: [{ id: "call_1", type: "function", function: { name: "web_search", arguments: '{"query":"ronaldo"}' } }],
            },
          }],
        }),
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "+4" } }] }),
      ),
      webSearch,
    );
    expect(await model.interpret("ronaldo", groups())).toBe(4);
    expect(webSearch.search).toHaveBeenCalledTimes(1);
  });

  it("handles the current_time tool call", async () => {
    const webSearch = { enabled: true, search: vi.fn(async () => []) } as unknown as KimiWebSearchService;
    const model = new KimiAiModel(
      config({ KIMI_API_KEY: "sk-test" }),
      stubFetch(
        JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              tool_calls: [{ id: "call_2", type: "function", function: { name: "current_time", arguments: '{"timezone":"Europe/Lisbon"}' } }],
            },
          }],
        }),
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "-1" } }] }),
      ),
      webSearch,
    );
    expect(await model.interpret("ronaldo", groups())).toBe(-1);
    expect(webSearch.search).not.toHaveBeenCalled();
  });
});