import type { AdapterCredentials, AdapterSample, SourceConfig } from "../../core/domain/source";
import type { RawDatum } from "../../core/domain/source-item";
import { BaseSource } from ".././base-source";
import { apiGetJson, bucketStart } from ".././http";

/**
 * Hacker News adapter — story/query volume via the free Algolia API:
 *   stories — matching story count in the window
 *   points  — Σ points of the top matching stories
 */
export class HackerNewsSearchAdapter extends BaseSource {
  readonly platform = "hackernews";
  readonly weight = 650; // 1-1000 credibility
  readonly kind = "community" as const;
  readonly fetchIntervalMs = 5 * 60_000;
  readonly requiredCredentials = [] as const;

  readonly metrics = [
    { key: "stories", label: "Stories", unit: "stories", higherIsBetter: true, source: "HN Algolia /search_by_date" },
    { key: "points", label: "Points", unit: "points", higherIsBetter: true, source: "HN Algolia /search_by_date" },
  ];

  id(config: SourceConfig): string {
    return `hackernews-${this.str(config, "query") ?? "top"}`;
  }

  label(config: SourceConfig): string {
    return `Hacker News — ${this.str(config, "query") ?? "top"}`;
  }

  async fetch(
    config: SourceConfig,
    since: number,
    now: number,
    _credentials?: AdapterCredentials,
  ): Promise<AdapterSample> {
    const query = this.str(config, "query") ?? "";
    try {
      const q = query ? `&query=${encodeURIComponent(query)}` : "";
      const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story${q}&numericFilters=created_at_i>${Math.floor(since / 1000)}&hitsPerPage=100`;
      const res = (await apiGetJson(url)) as {
        hits?: {
          objectID?: string;
          title?: string;
          story_text?: string;
          url?: string;
          author?: string;
          points?: number;
          num_comments?: number;
          created_at_i?: number;
        }[];
        nbHits?: number;
      };
      const t = bucketStart(now);
      const hits = res.hits ?? [];

      // The STORIES are the signal, not just the count: a title like "OpenAI ships
      // X" is what the AI should read, with its author and points as reach.
      const items: RawDatum[] = hits
        .filter((h) => h.title)
        .slice(0, 25)
        .map((h) => ({
          id: h.objectID,
          sourceName: this.label(config),
          text: `${h.title}${h.story_text ? ` — ${h.story_text}` : ""}`.slice(0, 400),
          url: h.url ?? (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : undefined),
          author: h.author ? `hn/${h.author}` : undefined,
          publishedAt: (h.created_at_i ?? 0) * 1000 || now,
          engagement: h.points ?? 0,
          stats: { upvotes: h.points ?? 0, replies: h.num_comments ?? 0 },
        }));

      return {
        points: {
          stories: [{ timestamp: t, value: res.nbHits ?? hits.length ?? 0 }],
          points: [{ timestamp: t, value: hits.reduce((acc, h) => acc + (h.points ?? 0), 0) }],
        },
        items,
      };
    } catch {
      return { points: {} };
    }
  }
}