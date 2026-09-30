import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AI_FETCH } from "../../../core/ports/tokens";
import { KimiWebSearchService } from "../../../jobs/ai/kimi-web-search.service";

export type AiFetch = (url: string, init: RequestInit) => Promise<Response>;

/** One source's scored items, grouped with its reliability weight (1-1000). */
export interface SourceGroup {
  label: string;
  /** Structural reliability weight — how credible the source is (1-1000). */
  reliability: number;
  /** Item texts — the sentiment the AI reads. */
  items: string[];
  /** Engagement metrics (value + delta) for the window. */
  metrics?: { name: string; value: number; delta: number }[];
  /** Per-source AI guidance (the handle's source JSON `context`). */
  context?: string;
  /** The handle topic — items mentioning it are flagged <<MENTION>>. */
  topic?: string;
}

/** Prior tick context (from the Postgres aura series + last summary) — helps
 *  the model score continuously/consistently. */
export interface PreviousTick {
  /** Previous aura level in display units (e.g. 30.40). */
  aura?: number;
  /** Previous delta in 2dp display units (e.g. 0.03, -1.24). */
  delta?: number;
  /** Previous tick's summary. */
  summary?: string;
}

interface KimiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  /** Tool name on role=tool messages — Kimi matches the pair (id + name). */
  name?: string;
}

interface KimiChoice {
  message?: KimiMessage;
}

interface KimiResponse {
  choices?: KimiChoice[];
  error?: { message?: string };
}

/** Shared scoring rules — one copy instead of two near-identical prompts
 *  (input tokens are the dominant AI cost; this halves the rules text). */
const SCORING_RULES =
  "You are the Aura index oracle. For ONE handle you are given its recent source activity, grouped by source, and you must decide how its aura moves this tick.\n" +
  "INPUT: each group has label, reliability (1-1000 credibility), engagement metrics (value + delta vs previous tick), item texts, optional context. Items referencing the handle are flagged <<MENTION>> — any textual reference (name, alias, trademark, clear indirect reference), even when the subject is not the actor.\n" +
  "DELTA (2 decimals, e.g. +0.03, 0, -0.08): 0 = no signal or balanced/noise; 0.01-0.05 TINY (credible mention in a positive/spotlight context); 0.06-0.10 SMALL; 0.11-0.50 MODERATE (solid positive development); 0.51-1.00 LARGE; above 1.00 VERY LARGE (decisive, high-reliability events only). Symmetric negatives for bearish news. Always 2 decimals.\n" +
  "JUDGMENT: score SENTIMENT from item texts, not metric counts; account for every <<MENTION>> item (never dismiss it); weight 900+ sources strongly; treat fan accounts/rumors/low-credibility content weakly; ignore spam, bots, clickbait; honor per-source context; net conflicting signals; never exaggerate one item; never invent events.\n";

const SYSTEM_PROMPT =
  SCORING_RULES +
  "OUTPUT: reply with ONLY a signed number to 2 decimals (e.g. +0.03, 0, -0.08). No JSON, no text, no explanation.";

const SUMMARY_SYSTEM_PROMPT =
  SCORING_RULES +
  'OUTPUT: reply with ONLY a JSON object: {"aura": <signed 2-decimal delta>, ' +
  '"summary": <one concise sentence naming the decisive signal(s)>}. No other text.';

const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current facts about a person or topic (latest news, results, injuries, records).",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The search query (e.g. 'Cristiano Ronaldo latest news')",
        },
      },
      required: ["query"],
    },
  },
};

const CURRENT_TIME_TOOL = {
  type: "function",
  function: {
    name: "current_time",
    description:
      "Get the current date and time in a timezone (e.g. 'UTC', 'Europe/Lisbon').",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA timezone, defaults to UTC",
        },
      },
    },
  },
};

const DELTA_CLAMP = 5; // ±2dp display-scale per tick (a ±5.00 aura move is already extreme)

/** Max tool-calling rounds per scoring call (search/time tools → final answer)
 *  — each round re-sends the full conversation, so low rounds = low tokens. */
const MAX_TOOL_ROUNDS = 2;

/**
 * Kimi (Moonshot) aura scorer. Reads ONE handle at a time, may
 * call the `web_search` tool (Kimi standalone Web Search API — no Tavily) for
 * live context, and its final output is ONLY a signed 2-decimal delta.
 */
@Injectable()
export class KimiAiModel {
  private readonly logger = new Logger(KimiAiModel.name);
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly fetchFn: AiFetch;
  private readonly baseUrl: string;
  private readonly webSearch?: KimiWebSearchService;

  constructor(
    config: ConfigService,
    @Inject(AI_FETCH) fetchFn: AiFetch,
    @Optional() webSearch?: KimiWebSearchService,
  ) {
    this.apiKey = config.get<string>("KIMI_API_KEY") ?? undefined;
    this.model = config.get<string>("KIMI_MODEL") ?? "kimi-k2.6";
    this.fetchFn = fetchFn;
    this.baseUrl = (
      config.get<string>("KIMI_BASE_URL") ?? "https://api.moonshot.ai/v1"
    ).replace(/\/$/, "");
    this.webSearch = webSearch;
  }

  /** Score the aura delta for ONE handle given its source groups. */
  async interpret(handleId: string, sources: SourceGroup[], previous?: PreviousTick): Promise<number> {
    const content = await this.run(handleId, sources, SYSTEM_PROMPT, false, previous);
    return parseDelta(content ?? "");
  }

  /** Returns the delta + a one-line reason (also carries prior-tick context). */
  async scoreWithSummary(
    handleId: string,
    sources: SourceGroup[],
    previous?: PreviousTick,
  ): Promise<{ aura: number; summary: string }> {
    const content = await this.run(
      handleId,
      sources,
      SUMMARY_SYSTEM_PROMPT,
      true,
      previous,
    );
    if (content) this.logger.debug(`scoreWithSummary reply: ${content}`);
    return parseSummary(content ?? "");
  }

  /** Shared tool-calling loop — returns the model's final text. */
  private async run(
    handleId: string,
    sources: SourceGroup[],
    systemPrompt: string,
    jsonMode: boolean,
    previous?: PreviousTick,
  ): Promise<string | null> {
    if (sources.length === 0) return null;
    if (!this.apiKey) {
      this.logger.warn(
        "KIMI_API_KEY not set — returning neutral 0 delta.",
      );
      return null;
    }

    const prevLine =
      previous
        ? `PREVIOUS TICK: aura=${previous.aura?.toFixed(2) ?? "?"}, delta=${previous.delta !== undefined ? (previous.delta > 0 ? "+" : "") + previous.delta.toFixed(2) : "?"}, summary="${(previous.summary ?? "").slice(0, 200)}"\n`
        : "";
    const user =
      prevLine +
      `Handle: @${handleId}\n` +
      `Sources:\n` +
      sources
        .map((s) => {
          const metrics =
            s.metrics && s.metrics.length > 0
              ? ` metrics=[${s.metrics.map((m) => `${m.name}=${m.value}(Δ${m.delta})`).join(", ")}]`
              : "";
          const topic = s.topic?.toLowerCase();
          const items =
            s.items.length > 0
              ? ` items=[${s.items.map((t) => (topic && t.toLowerCase().includes(topic) ? `<<MENTION>> ${t}` : t).slice(0, 240)).join('", "')}]`
              : "";
          const ctx = s.context ? ` context="${s.context}"` : "";
          return `- ${s.label} (reliability ${s.reliability})${metrics}${items}${ctx}`;
        })
        .join("\n");

    const tools = this.webSearch?.enabled
      ? [WEB_SEARCH_TOOL, CURRENT_TIME_TOOL]
      : undefined;
    const messages: KimiMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: user },
    ];

    try {
      // Tool rounds: the model may call web_search (Kimi search API) or
      // current_time; we feed results back verbatim until it answers in text.
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const res = await this.complete(messages, tools);
        if (!res) return null;
        const toolCalls = res.tool_calls ?? [];
        if (toolCalls.length === 0 || !tools) {
          if (jsonMode) break; // re-ask below with response_format
          return res.content ?? null;
        }
        // Keep the assistant message (with tool_calls) verbatim, then answer
        // every call with a role=tool message (id + name aligned one-to-one).
        messages.push({
          role: "assistant",
          content: res.content ?? null,
          tool_calls: res.tool_calls,
        });
        for (const call of toolCalls) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: await this.execTool(call, handleId),
          });
        }
      }
      // Final pass: no tools, optional JSON mode — the model's text answer.
      const final = await this.complete(messages, undefined, jsonMode);
      return final?.content ?? null;
    } catch (error) {
      this.logger.error(`Aura scoring failed: ${(error as Error).message}`);
      return null;
    }
  }

  /** Execute ONE tool call locally and return the tool result as a string. */
  private async execTool(
    call: { id: string; type: "function"; function: { name: string; arguments: string } },
    handleId: string,
  ): Promise<string> {
    if (call.function.name === "web_search") {
      const args = safeArgs(call.function.arguments);
      const query = String(args?.query ?? handleId);
      const results = (await this.webSearch?.search(query)) ?? [];
      return JSON.stringify(
        results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet.slice(0, 180),
        })),
      );
    }
    if (call.function.name === "current_time") {
      return JSON.stringify(currentTime(safeArgs(call.function.arguments)?.timezone));
    }
    return JSON.stringify({ error: `unknown tool '${call.function.name}'` });
  }

  private async complete(
    messages: KimiMessage[],
    tools?: unknown,
    jsonMode = false,
  ): Promise<KimiMessage | null> {
    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        // Economic output caps: tool queries are one-liners, the delta is a
        // number, the summary JSON is two short fields.
        max_tokens: jsonMode ? 224 : tools ? 96 : 24,
        messages,
        // Full tools declaration on every tool request; tool_choice "auto" is
        // the documented default — set explicitly per Kimi's tool-choice guide.
        ...(tools ? { tools, tool_choice: "auto" } : {}),
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Kimi HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as KimiResponse;
    if (data.error?.message) throw new Error(data.error.message);
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("Empty Kimi completion");
    return message;
  }
}

function safeArgs(raw: string): { query?: string; timezone?: string } | null {
  try {
    const parsed = JSON.parse(raw) as { query?: string; timezone?: string };
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** Current time in a timezone (default UTC) — mirrors the backend time tool. */
function currentTime(tz?: string): {
  timezone: string;
  iso: string;
  formatted: string;
} {
  const timezone = tz || "UTC";
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "long",
    }).format(new Date());
    return { timezone, iso: new Date().toISOString(), formatted };
  } catch {
    return {
      timezone,
      iso: new Date().toISOString(),
      formatted: new Date().toISOString(),
    };
  }
}

/** Extract the ONLY signed 2-decimal number ("+0.03", "-0.08", "1.24"). */
function parseDelta(content: string): number {
  const match = /[+-]?\d+(?:\.\d+)?/.exec(content);
  if (!match) return 0;
  const n = parseFloat(match[0]);
  if (!Number.isFinite(n)) return 0;
  return clamp2dp(n);
}

function clamp2dp(n: number): number {
  return Math.min(
    DELTA_CLAMP,
    Math.max(-DELTA_CLAMP, Math.round(n * 100) / 100),
  );
}

/** Parse the quick-test output {"aura": <int>, "summary": "<reason>"}. */
function parseSummary(content: string): { aura: number; summary: string } {
  try {
    const parsed = JSON.parse(content) as { aura?: unknown; summary?: unknown };
    if (typeof parsed !== "object" || parsed === null)
      return { aura: 0, summary: "" };
    const n =
      typeof parsed.aura === "number"
        ? parsed.aura
        : typeof parsed.aura === "string"
          ? parseFloat(parsed.aura)
          : NaN;
    return {
      aura: Number.isFinite(n) ? clamp2dp(n) : 0,
      summary:
        typeof parsed.summary === "string" ? parsed.summary.slice(0, 300) : "",
    };
  } catch {
    // Bare-integer fallback.
    return { aura: parseDelta(content), summary: "" };
  }
}
