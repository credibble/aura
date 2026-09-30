import type { AdapterSample, SourceConfig } from "../core/domain/source";
import type { RawDatum } from "../core/domain/source-item";
import { BaseSource } from "./base-source";
import { bucketStart } from "./http";
import { fetchText } from "../ingestion/http";
import { parseFeed } from "../ingestion/rss-parser";

/**
 * Generic RSS adapter — ANY cross-domain RSS/Atom feed (Tesla, Apple, crypto,
 * gaming, music, space...). Point it at a feed URL via the on-chain source
 * config:
 * `{ platform: "rss", feed: "<rss url>", outlet: "<id>", topic: "<name>", label: "..." }`.
 * Extracts article volume + topic coverage and emits scored feed items
 * (kind = media), like the BBC/FOX RSS adapters but outlet-agnostic.
 */
export class RssAdapter extends BaseSource {
  readonly platform = "rss";
  readonly weight = 840; // 1-1000 credibility (established outlet, config-driven)
  readonly kind = "media" as const;
  readonly fetchIntervalMs = 5 * 60_000;

  readonly metrics = [
    { key: "articles", label: "Articles", unit: "articles", higherIsBetter: true, source: "RSS feed" },
    { key: "coverage", label: "Topic Coverage", unit: "articles", higherIsBetter: true, source: "RSS feed" },
  ];

  id(config: SourceConfig): string {
    const outlet = this.str(config, "outlet");
    if (outlet) return `rss-${outlet}`;
    const feed = this.str(config, "feed");
    if (feed) {
      try {
        return `rss-${new URL(feed).hostname.replace(/^www\./, "")}`;
      } catch {
        // invalid URL — fall through
      }
    }
    return "rss";
  }

  label(config: SourceConfig): string {
    return this.str(config, "label") ?? this.str(config, "outlet") ?? "RSS feed";
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
