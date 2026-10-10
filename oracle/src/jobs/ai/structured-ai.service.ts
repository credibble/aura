import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AI_FETCH } from "../../core/ports/tokens";
import { kimiRequest } from "../../adapters/ai/llm/kimi-limiter";
import { unfenceJson, type AiFetch } from "../../adapters/ai/llm/kimi-ai.model";
import { isDebugMode, DEBUG_TEXT_SAMPLE, debugJsonSample } from "../../config/debug";

/**
 * Structured Kimi completion used by the job engines (aura scoring, feed
 * writing). Prompts always demand a strict JSON object so the engines get a
 * typed, sanitized reply. Shared with the interpret model (same key/model).
 */
@Injectable()
export class StructuredAiService {
  private readonly logger = new Logger(StructuredAiService.name);
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(
    config: ConfigService,
    @Inject(AI_FETCH) private readonly fetchFn: AiFetch,
  ) {
    this.apiKey = config.get<string>("KIMI_API_KEY") ?? undefined;
    this.model = config.get<string>("KIMI_MODEL") ?? "kimi-k2.6";
    this.baseUrl = (config.get<string>("KIMI_BASE_URL") ?? "https://api.moonshot.ai/v1").replace(/\/$/, "");
  }

  /** Raw completion — returns the model's text verbatim (integer-only prompts).
   *  Returns null when the API is unconfigured or the call fails. */
  async complete(system: string, user: string): Promise<string | null> {
    // DEBUG_MODE: no provider call, no slot/lock — a marked sample instead.
    if (isDebugMode()) {
      this.logger.warn("[debug] complete short-circuited — returning a sample (no AI call).");
      return DEBUG_TEXT_SAMPLE;
    }
    if (!this.apiKey) {
      this.logger.warn("KIMI_API_KEY not set — returning null.");
      return null;
    }
    try {
      // `kimiRequest` serialises this against every other AI call (the org allows
      // one in-flight request) and retries 429/5xx with backoff.
      const res = await kimiRequest(() =>
        this.fetchFn(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: this.model,
            // k2.* accepts ONLY temperature 1 — 0 was rejected with a 400 on
            // every call, so this path always fell back to the caller's default.
            temperature: 1,
            // Economic cap, but a REASONING model spends thinking tokens from
            // this budget first: at 400 every call was truncated to `content: ""`
            // (finish_reason "length"). Only generated tokens are billed.
            max_tokens: 4096,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        }),
      );
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };
      if (data.error?.message) throw new Error(data.error.message);
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty Kimi completion content");
      return content.trim();
    } catch (error) {
      this.logger.error(`Structured completion failed: ${(error as Error).message}`);
      return null;
    }
  }

  /** Send a JSON-mode completion; returns the parsed object (never throws on
   *  shape — the caller sanitizes). Returns null when the API is unconfigured. */
  async completeJson<T>(system: string, user: string, fallback: T): Promise<T | null> {
    // DEBUG_MODE: no provider call, no slot/lock — the caller's fallback tagged
    // as a debug sample so it is distinguishable from a real reply.
    if (isDebugMode()) {
      this.logger.warn("[debug] completeJson short-circuited — returning a sample (no AI call).");
      return debugJsonSample(fallback);
    }
    if (!this.apiKey) {
      this.logger.warn("KIMI_API_KEY not set — returning fallback.");
      return fallback;
    }
    try {
      const res = await kimiRequest(() =>
        this.fetchFn(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: this.model,
            // k2.* accepts ONLY temperature 1 (see complete()).
            temperature: 1,
            // Economic cap, but thinking tokens are spent first: at 256 the
            // reasoning budget alone consumed the reply and `content` came back
            // empty every time (measured 255/256 reasoning tokens).
            max_tokens: 4096,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        }),
      );
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };
      if (data.error?.message) throw new Error(data.error.message);
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty Kimi completion content");
      return JSON.parse(unfenceJson(content)) as T;
    } catch (error) {
      this.logger.error(`Structured completion failed: ${(error as Error).message}`);
      return fallback;
    }
  }
}