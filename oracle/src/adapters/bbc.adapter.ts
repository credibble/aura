import type { AdapterSample, SourceConfig } from "../core/domain/source";
import type { RawDatum } from "../core/domain/source-item";
import { BaseSource } from "./base-source";
import { bucketStart } from "./http";
import { fetchText } from "../ingestion/http";
import { parseFeed } from "../ingestion/rss-parser";

/**
 * BBC adapter (BBC / any RSS or GDELT news outlet) — extracts the outlet's OWN
 * metrics its own way while still producing scored feed items:
 *   articles  — article volume in the window (its own way: RSS/GDELT query)
 *   coverage  — how many feed items mention the handle's topic
 * The feed items also flow into sentiment scoring (kind = media).
 */
export class BbcAdapter extends BaseSource {
  readonly platform = "bbc";
  readonly weight = 900; // 1-1000 credibility
  readonly kind = "media" as const;
  readonly fetchIntervalMs = 5 * 60_000;

  readonly metrics = [
    { key: "articles", label: "Articles", unit: "articles", higherIsBetter: true, source: "RSS feed | GDELT doc API" },
    { key: "coverage", label: "Topic Coverage", unit: "articles", higherIsBetter: true, source: "RSS feed | GDELT doc API" },
  ];

  id(config: SourceConfig): string {
    const outlet = this.str(config, "outlet") ?? "bbc";
    return outlet;
  }

  label(config: SourceConfig): string {
    return this.str(config, "label") ?? `BBC — ${this.id(config)}`;
  }

  async fetch(config: SourceConfig, since: number, now: number): Promise<AdapterSample> {
    const feedUrl = this.str(config, "feed");
    const query = this.str(config, "query");
    const t = bucketStart(now);

    let items: RawDatum[] = [];
    if (feedUrl) {
      try {
        const xml = await fetchText(feedUrl, { timeoutMs: 12_000 });
        items = parseFeed(xml, this.label(config)).filter((d) => d.publishedAt >= since);
      } catch {
        items = [];
      }
    } else if (query) {
      try {
        const res = await fetchText(
          `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${query}"`)}&mode=artlist&format=json&maxrecords=25`,
          { timeoutMs: 12_000 },
        );
        const parsed = JSON.parse(res) as { articles?: { title?: string; url?: string; domain?: string }[] };
        items = (parsed.articles ?? [])
          .filter((a) => a.title)
          .map((a) => ({
            id: a.url,
            sourceName: a.domain ?? this.label(config),
            text: a.title ?? "",
            url: a.url,
            publishedAt: now,
          }));
      } catch {
        items = [];
      }
    }

    return {
      points: {
        articles: [{ timestamp: t, value: items.length }],
        coverage: [{ timestamp: t, value: items.filter((d) => (config.topic ? d.text.toLowerCase().includes(String(config.topic).toLowerCase()) : d.text.length > 0)).length }],
      },
      items,
    };
  }
}