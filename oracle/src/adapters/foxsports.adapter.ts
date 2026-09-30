import type { AdapterSample, SourceConfig } from "../core/domain/source";
import type { RawDatum } from "../core/domain/source-item";
import { BaseSource } from "./base-source";
import { bucketStart } from "./http";
import { fetchText } from "../ingestion/http";
import { parseFeed } from "../ingestion/rss-parser";

/**
 * FOX Sports soccer adapter — extracts the outlet's OWN metrics (article
 * volume + topic coverage) and produces scored feed items (kind = media).
 * The feed URL is REQUIRED from the on-chain source config:
 * `{ platform: "foxsports", feed: "<rss url>", topic: "<name>", label: "..." }`.
 */
export class FoxSportsAdapter extends BaseSource {
  readonly platform = "foxsports";
  readonly weight = 860; // 1-1000 credibility (established sports outlet)
  readonly kind = "media" as const;
  readonly fetchIntervalMs = 5 * 60_000;

  readonly metrics = [
    { key: "articles", label: "Articles", unit: "articles", higherIsBetter: true, source: "FOX Sports RSS" },
    { key: "coverage", label: "Topic Coverage", unit: "articles", higherIsBetter: true, source: "FOX Sports RSS" },
  ];

  id(config: SourceConfig): string {
    return this.str(config, "outlet") ?? "foxsports";
  }

  label(config: SourceConfig): string {
    return this.str(config, "label") ?? "FOX Sports";
  }

  async fetch(config: SourceConfig, since: number, now: number): Promise<AdapterSample> {
    const feedUrl = this.str(config, "feed");
    const topic = this.str(config, "topic");
    const t = bucketStart(now);

    let items: RawDatum[] = [];
    if (feedUrl) {
      try {
        const xml = await fetchText(feedUrl, { timeoutMs: 15_000 });
        items = parseFeed(xml, this.label(config)).filter((d) => d.publishedAt >= since);
      } catch {
        items = [];
      }
    }

    const mentions = topic
      ? items.filter((d) => d.text.toLowerCase().includes(topic.toLowerCase())).length
      : items.length;

    return {
      points: {
        articles: [{ timestamp: t, value: items.length }],
        coverage: [{ timestamp: t, value: mentions }],
      },
      items,
    };
  }
}