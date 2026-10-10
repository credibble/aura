import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { kimiRequest } from "../../adapters/ai/llm/kimi-limiter";
import { isDebugMode, sampleWebResults } from "../../config/debug";

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

/**
 * Kimi web search — the aura AI's live-context tool, backed by the Moonshot
 * standalone Web Search Basic API (`POST /v1/tools/search`). Replaces the old
 * Tavily integration; the chat model stays on the Kimi endpoint (chat
 * completions against Moonshot) while search runs against the Kimi
 * platform (per-call billing).
 */
@Injectable()
export class KimiWebSearchService {
  private readonly logger = new Logger(KimiWebSearchService.name);
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly maxResults: number;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>("MOONSHOT_API_KEY") ?? undefined;
    this.baseUrl = (
      config.get<string>("MOONSHOT_BASE_URL") ?? "https://api.moonshot.ai/v1"
    ).replace(/\/$/, "");
    this.maxResults = config.get<number>("WEB_SEARCH_LIMIT") ?? 5;
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  /** Search the web for live facts; returns [] on any failure (tool is optional). */
  async search(query: string, maxResults = this.maxResults): Promise<WebResult[]> {
    // DEBUG_MODE: no network at all — a marked sample result stands in.
    if (isDebugMode()) {
      this.logger.warn("[debug] search short-circuited — returning a sample (no network).");
      return sampleWebResults(query);
    }
    if (!this.apiKey) {
      this.logger.warn("MOONSHOT_API_KEY not set — web search unavailable.");
      return [];
    }
    try {
      // `/tools/search` bills and rate-limits against the SAME organisation
      // concurrency (1) as chat completions, so an un-serialised search here is
      // exactly what made a concurrent chat call 429. Same single slot as every
      // other Kimi call — `kimiRequest` owns retry + error text.
      const res = await kimiRequest(() =>
        fetch(`${this.baseUrl}/tools/search`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            text_query: query,
            limit: maxResults,
            timeout_seconds: 30,
          }),
          // Bound the request: it is held inside the shared slot, so a hung
          // search must not outlive the lock's TTL and let a second call in.
          signal: AbortSignal.timeout(90_000),
        }),
      );
      const data = (await res.json()) as {
        search_results?: { title?: string; url?: string; snippet?: string; date?: string }[];
      };
      return (data.search_results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: (r.snippet ?? "").slice(0, 400),
      }));
    } catch (error) {
      this.logger.error(`Kimi web search failed: ${(error as Error).message}`);
      return [];
    }
  }
}
