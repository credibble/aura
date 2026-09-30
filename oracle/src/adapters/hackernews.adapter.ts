import type { AdapterCredentials, AdapterSample, SourceConfig } from "../core/domain/source";
import { BaseSource } from "./base-source";
import { apiGetJson, bucketStart } from "./http";

/**
 * Hacker News adapter — story/query volume via the free Algolia API:
 *   stories — matching story count in the window
 *   points  — Σ points of the top matching stories
 */
export class HackerNewsAdapter extends BaseSource {
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
      const res = await apiGetJson(url) as { hits?: { points?: number }[]; nbHits?: number };
      const t = bucketStart(now);
      return {
        points: {
          stories: [{ timestamp: t, value: res.nbHits ?? res.hits?.length ?? 0 }],
          points: [{ timestamp: t, value: res.hits?.reduce((acc, h) => acc + (h.points ?? 0), 0) ?? 0 }],
        },
      };
    } catch {
      return { points: {} };
    }
  }
}