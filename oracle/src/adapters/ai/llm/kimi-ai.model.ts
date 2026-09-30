import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AI_FETCH } from "../../../core/ports/tokens";
import { KimiWebSearchService } from "../../../jobs/ai/kimi-web-search.service";
import { kimiRequest } from "./kimi-limiter";

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
  "You are the Aura index oracle. For ONE handle you are given its recent source activity, grouped by source, and you must decide how much its aura moves this tick.\n" +
  "INPUT: each group has label, reliability (1-1000 credibility), engagement metrics (value + delta vs previous tick), item texts, optional context. Items referencing the handle are flagged <<MENTION>> — any textual reference (name, alias, trademark, clear indirect reference), even when the subject is not the actor.\n" +
  "OUTPUT SCALE: a PERCENT change of the handle's current aura, signed, one decimal (e.g. +2.5, -0.4, 0). It is applied to the live level: an aura of 100 with -5% becomes 95.\n" +
  "BANDS (percent): 0.2-0.5 TINY (a credible mention in a positive/spotlight context); 0.6-1.5 SMALL; 1.6-3 MODERATE (a solid positive development); 3.1-4 LARGE; 4.1-5 VERY LARGE (decisive, high-reliability events only). Symmetric negatives for bearish news. NEVER exceed ±5, never go below ±0.2 in magnitude — if the honest read is 'no real change', still answer the minimum ±0.2 in the direction of the residual signal.\n" +
  "JUDGMENT: score SENTIMENT from item texts, not metric counts; account for every <<MENTION>> item (never dismiss it); weight 900+ sources strongly; treat fan accounts/rumors/low-credibility content weakly; ignore spam, bots, clickbait; honor per-source context; net conflicting signals; never exaggerate one item; never invent events.\n";

const SYSTEM_PROMPT =
  SCORING_RULES +
  "OUTPUT: reply with ONLY a signed percent to one decimal (e.g. +2.5, -0.4). No JSON, no text, no explanation.";

const SUMMARY_SYSTEM_PROMPT =
  SCORING_RULES +
  'OUTPUT: reply with ONLY a JSON object: {"percent": <signed percent, one decimal>, ' +
  '"summary": <AT MOST 12 words, one clause, the decisive signal — this string is written ' +
  "ON-CHAIN as the tick's memo, so it must be short, factual and standalone (no emoji, no " +
  "hashtag, no trailing period)>}. No other text.";

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
  /** `kimi-k2.*` only accepts 1; older moonshot-v1 models take 0..1. */
  private readonly temperature: number;
  /**
   * Token budgets — sized for a REASONING model, where the thinking tokens are
   * spent before any answer. Each needs generous headroom or the reply comes back
   * empty (`finish_reason: "length"`).
   */
  private readonly maxTokensDelta: number;
  private readonly maxTokensTools: number;
  private readonly maxTokensJson: number;
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
    // `kimi-k2.*` rejects any temperature but 1 with a 400 ("invalid
    // temperature: only 1 is allowed for this model"); the env override is only
    // honoured for older moonshot-v1 models.
    const configuredTemperature = Number(config.get<string>("KIMI_TEMPERATURE") ?? 1);
    this.temperature = /^kimi-k2/i.test(this.model) ? 1 : configuredTemperature;
    // Reasoning-model budgets: thinking tokens are spent BEFORE any answer and
    // come out of max_tokens. Measured on kimi-k2.6: a 256-token call spent 255
    // reasoning tokens and returned `content: ""` (finish_reason "length"), and
    // even a short JSON answer needed ~985 tokens. 2048 fit the small probe but
    // truncated the large aura prompt; budgets must leave real headroom for the
    // answer, since only the tokens actually generated are billed.
    this.maxTokensDelta = Number(config.get<string>("KIMI_MAX_TOKENS_DELTA") ?? 8192);
    this.maxTokensTools = Number(config.get<string>("KIMI_MAX_TOKENS_TOOLS") ?? 8192);
    this.maxTokensJson = Number(config.get<string>("KIMI_MAX_TOKENS_JSON") ?? 8192);
    this.fetchFn = fetchFn;
    this.baseUrl = (
      config.get<string>("KIMI_BASE_URL") ?? "https://api.moonshot.ai/v1"
    ).replace(/\/$/, "");
    this.webSearch = webSearch;
  }

  /** Score the aura delta for ONE handle given its source groups. */
  async interpret(handleId: string, sources: SourceGroup[], previous?: PreviousTick): Promise<number> {
    const content = await this.run(handleId, sources, SYSTEM_PROMPT, false, previous);
    // Same contract as the scoring path: a signed percent, clamped to ±5.
    return clampPercent(parseDelta(content ?? ""));
  }

  /** Returns the delta + a one-line reason (also carries prior-tick context). */
  async scoreWithSummary(
    handleId: string,
    sources: SourceGroup[],
    previous?: PreviousTick,
  ): Promise<{ percent: number; summary: string }> {
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
    return this.requestCompletion(messages, tools, jsonMode);
  }

  /** One request — `kimiRequest` serialises it against every other AI caller. */
  private async requestCompletion(
    messages: KimiMessage[],
    tools: unknown,
    jsonMode: boolean,
  ): Promise<KimiMessage | null> {
    const body = JSON.stringify({
      model: this.model,
      // `kimi-k2.*` accepts ONLY temperature 1 ("invalid temperature: only 1 is
      // allowed for this model") — sending 0 failed every scoring/draft call
      // with a 400, which is why every feed post was the fallback text and the
      // aura engine never scored. Configurable for older moonshot-v1 models.
      temperature: this.temperature,
      // k2.* is a REASONING model: thinking tokens come out of max_tokens, so a
      // tight budget returns `content: ""` with finish_reason "length" (a
      // 24-token delta call spent 23 on reasoning and answered nothing).
      // Budgets must leave room for the actual answer.
      max_tokens: jsonMode ? this.maxTokensJson : tools ? this.maxTokensTools : this.maxTokensDelta,
      messages,
      // Full tools declaration on every tool request; tool_choice "auto" is
      // the documented default — set explicitly per Kimi's tool-choice guide.
      ...(tools ? { tools, tool_choice: "auto" } : {}),
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    });

    const res = await kimiRequest(() =>
      this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body,
      }),
    );

    const data = (await res.json()) as KimiResponse;
    if (data.error?.message) throw new Error(data.error.message);
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("Empty Kimi completion");
    // A reasoning model can spend its whole budget thinking and return
    // `content: ""` with no tool calls (`finish_reason: "length"`). That is a
    // failed completion, not an answer — fail closed so the caller uses its
    // fallback instead of propagating an empty string.
    if (!message.content && !(message.tool_calls && message.tool_calls.length > 0)) {
      throw new Error("Empty Kimi completion content");
    }
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

/** Extract the only signed number ("+2.5", "-0.4", "3") from a bare reply. */
function parseDelta(content: string): number {
  const match = /[+-]?\d+(?:\.\d+)?/.exec(content);
  if (!match) return 0;
  const n = parseFloat(match[0]);
  return Number.isFinite(n) ? n : 0;
}

/** How the AI's tick answer is parsed: a signed PERCENT, clamped to ±5. */
const PERCENT_LIMIT = 5;
/**
 * The summary is written ON-CHAIN as `Handle.updateAura`'s memo, so it is capped
 * hard — a long string is pure gas, and it has to read well in a chart tooltip.
 */
const MEMO_MAX = 120;

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.max(-PERCENT_LIMIT, Math.min(PERCENT_LIMIT, n));
  return Math.round(clamped * 10) / 10;
}

/** One clean line, ≤ MEMO_MAX chars, no trailing period. */
function cleanMemo(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").replace(/[`"'<>]/g, "").trim();
  const trimmed = flat.length > MEMO_MAX ? `${flat.slice(0, MEMO_MAX - 1).trimEnd()}…` : flat;
  return trimmed.replace(/[.\s]+$/, "");
}

/** Parse the scoring output {"percent": <n>, "summary": "<memo>"} (exported for tests). */
export function parseSummary(content: string): { percent: number; summary: string } {
  try {
    const parsed = JSON.parse(content) as unknown;
    // A bare number is valid JSON ("-0.4") — that IS the percent.
    if (typeof parsed === "number") return { percent: clampPercent(parsed), summary: "" };
    if (typeof parsed !== "object" || parsed === null) return { percent: 0, summary: "" };
    const obj = parsed as { percent?: unknown; aura?: unknown; summary?: unknown };
    // `aura` is tolerated: a stale prompt/model can still answer in the old key.
    const raw = obj.percent ?? obj.aura;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
    return {
      percent: clampPercent(n),
      summary: typeof obj.summary === "string" ? cleanMemo(obj.summary) : "",
    };
  } catch {
    // Bare-number fallback.
    return { percent: clampPercent(parseDelta(content)), summary: "" };
  }
}
