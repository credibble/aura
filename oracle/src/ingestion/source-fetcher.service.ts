import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdapterRegistry } from "../adapters/adapter-registry.service";
import { TIME_SERIES_STORE, CONNECTION_STORE } from "../core/ports/tokens";
import type { ITimeSeriesStore } from "../core/ports/time-series-store";
import type { IConnectionStore } from "../core/ports/connection-store";
import type { Source, SourceTransport } from "../core/domain/source";
import type { AdapterCredentials } from "../core/domain/source";
import type { RawDatum } from "../core/domain/source-item";
import { fetchJson, fetchText } from "./http";
import { parseFeed } from "./rss-parser";

/**
 * Fetches a single source according to its transport. Adapter sources (those
 * carrying a `platform` config) are handed to their BaseSource — the platform
 * adapter's own credentials (OAuth / API keys) are resolved from the
 * ConnectionStore and passed in (never stored on-chain) — and its extracted
 * metrics land in the time-series store. Transport sources are fetched directly.
 * The collector decides which sources are ready, this service performs the
 * actual retrieval.
 */
@Injectable()
export class SourceFetcher {
  constructor(
    private readonly config: ConfigService,
    private readonly adapters: AdapterRegistry,
    @Inject(TIME_SERIES_STORE) private readonly series: ITimeSeriesStore,
    @Inject(CONNECTION_STORE) private readonly connections: IConnectionStore,
  ) {}

  async fetch(source: Source, since: number, limit = 25): Promise<RawDatum[]> {
    if (source.adapter) {
      const adapter = this.adapters.resolve(source.adapter);
      if (!adapter) return [];
      const account = typeof source.adapter.account === "string" ? source.adapter.account : undefined;
      // App-level credentials (an `api/` adapter reading OTHER people's public
      // data) live in the oracle's own env, not a per-account ConnectionStore
      // row — the app has one key, not one per subject. Per-user OAuth
      // (`connections/`) keeps resolving from the store first.
      const credentials =
        (await this.connections.get(source.adapter.platform, account)) ??
        this.systemCredentials(adapter.requiredCredentials);
      const sample = await adapter.fetch(source.adapter, since, Date.now(), credentials ?? undefined);
      await this.series.appendSample(source.id, sample.points);
      return sample.items ?? [];
    }

    const t = source.transport;
    if (!t) return [];
    switch (t.type) {
      case "rss":
        return this.rss(t, source.label, since, limit);
      case "reddit":
        return this.reddit(t, source.label, since, limit);
      case "gdelt":
        return this.gdelt(t, since, limit);
      case "youtube":
        return this.youtube(t, since, limit);
      case "hackernews":
        return this.hackernews(t, since, limit);
      case "github":
        return this.github(t, limit);
      case "wikipedia":
        return this.wikipedia(t, limit);
    }
  }

  /**
   * App-level credentials from env. Each required credential `platform:name`
   * maps to `${PLATFORM}_${SNAKE(name)}` — e.g. `x:bearerToken` →
   * `X_BEARER_TOKEN`, `youtube:apiKey` → `YOUTUBE_API_KEY` — so the adapter
   * declares what it needs and the deploy supplies it without a DB row. Missing
   * vars are simply omitted (the adapter then fails closed, never fabricates).
   */
  private systemCredentials(required: readonly string[]): AdapterCredentials | undefined {
    const secrets: Record<string, string> = {};
    for (const credential of required) {
      const value = this.config.get<string>(envKey(credential));
      if (typeof value === "string" && value.length > 0) secrets[credential] = value;
    }
    return Object.keys(secrets).length > 0 ? { secrets } : undefined;
  }

  private async rss(t: Extract<SourceTransport, { type: "rss" }>, label: string, since: number, limit: number): Promise<RawDatum[]> {
    try {
      const xml = await fetchText(t.feedUrl, { timeoutMs: 12_000 });
      return parseFeed(xml, label).filter((d) => d.publishedAt >= since).slice(0, limit);
    } catch {
      return [];
    }
  }

  private async reddit(t: Extract<SourceTransport, { type: "reddit" }>, label: string, since: number, limit: number): Promise<RawDatum[]> {
    try {
      const url = `https://www.reddit.com/r/${t.subreddit}/.rss?limit=${limit}`;
      const xml = await fetchText(url, { timeoutMs: 12_000 });
      return parseFeed(xml, label).filter((d) => d.publishedAt >= since).slice(0, limit);
    } catch {
      return [];
    }
  }

  private async gdelt(t: Extract<SourceTransport, { type: "gdelt" }>, since: number, limit: number): Promise<RawDatum[]> {
    try {
      const url =
        `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${t.query}"`)}` +
        `&mode=artlist&format=json&maxrecords=${limit}&startdatetime=${gdeltTime(since)}`;
      const res = await fetchJson<{ articles?: { title?: string; url?: string; domain?: string; seendate?: string }[] }>(url, { timeoutMs: 12_000 });
      return (res.articles ?? []).filter((a) => a.title).map((a) => ({
        id: a.url,
        sourceName: a.domain ?? "GDELT",
        text: a.title ?? "",
        url: a.url,
        publishedAt: parseSeen(a.seendate),
      }));
    } catch {
      return [];
    }
  }

  private async youtube(t: Extract<SourceTransport, { type: "youtube" }>, since: number, limit: number): Promise<RawDatum[]> {
    const apiKey = this.config.get<string>("YOUTUBE_API_KEY");
    if (!apiKey) return [];
    try {
      const url =
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(t.query)}` +
        `&type=video&maxResults=${limit}&publishedAfter=${new Date(since).toISOString()}&key=${apiKey}`;
      const res = await fetchJson<{ items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; publishedAt?: string; thumbnails?: { high?: { url?: string } } } }[] }>(url, { timeoutMs: 12_000 });
      return (res.items ?? []).filter((it) => it.snippet?.title).map((it) => ({
        id: it.id?.videoId,
        sourceName: it.snippet?.channelTitle ?? "YouTube",
        text: it.snippet?.title ?? "",
        url: it.id?.videoId ? `https://www.youtube.com/watch?v=${it.id.videoId}` : undefined,
        author: it.snippet?.channelTitle,
        publishedAt: parseIso(it.snippet?.publishedAt),
        media: it.snippet?.thumbnails?.high?.url ? [{ kind: "image" as const, url: it.snippet.thumbnails.high.url }] : undefined,
      }));
    } catch {
      return [];
    }
  }

  private async hackernews(t: Extract<SourceTransport, { type: "hackernews" }>, since: number, limit: number): Promise<RawDatum[]> {
    try {
      const url =
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(t.query)}` +
        `&tags=story&hitsPerPage=${limit}&numericFilters=created_at_i>${Math.floor(since / 1000)}`;
      const res = await fetchJson<{ hits?: { objectID?: string; title?: string; url?: string; author?: string; points?: number; created_at?: string }[] }>(url, { timeoutMs: 12_000 });
      return (res.hits ?? []).filter((h) => h.title).map((h) => ({
        id: h.objectID,
        sourceName: `Hacker News / ${h.author ?? "user"}`,
        text: h.title ?? "",
        url: h.url,
        author: h.author,
        publishedAt: parseIso(h.created_at),
        engagement: h.points,
      }));
    } catch {
      return [];
    }
  }

  private async github(t: Extract<SourceTransport, { type: "github" }>, limit: number): Promise<RawDatum[]> {
    try {
      const url =
        `https://api.github.com/search/repositories?q=${encodeURIComponent(`${t.query} pushed:>${daysAgo(7)}`)}` +
        `&sort=updated&order=desc&per_page=${limit}`;
      const res = await fetchJson<{ items?: { id?: number; full_name?: string; description?: string | null; html_url?: string; stargazers_count?: number; pushed_at?: string }[] }>(url, {
        timeoutMs: 12_000,
        headers: { accept: "application/vnd.github+json" },
      });
      return (res.items ?? []).map((r) => ({
        id: String(r.id ?? r.html_url),
        sourceName: r.full_name ?? "GitHub",
        text: r.description ? `${r.full_name}: ${r.description}` : (r.full_name ?? ""),
        url: r.html_url,
        publishedAt: parseIso(r.pushed_at),
        engagement: r.stargazers_count,
      }));
    } catch {
      return [];
    }
  }

  private async wikipedia(t: Extract<SourceTransport, { type: "wikipedia" }>, limit: number): Promise<RawDatum[]> {
    try {
      const url =
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(t.query)}` +
        `&srlimit=${limit}&srprop=timestamp&utf8=1&format=json&origin=*`;
      const res = await fetchJson<{ query?: { search?: { title?: string; snippet?: string; timestamp?: string }[] } }>(url, { timeoutMs: 12_000 });
      return (res.query?.search ?? []).filter((s) => s.title).map((s) => ({
        id: s.title,
        sourceName: "Wikipedia",
        text: `${s.title} — ${stripHtml(s.snippet ?? "")}`,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title ?? "")}`,
        publishedAt: parseIso(s.timestamp),
      }));
    } catch {
      return [];
    }
  }


}

function gdeltTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function parseSeen(value?: string): number {
  if (!value) return Date.now();
  const m = /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})/.exec(value);
  if (!m) return Date.now();
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

function parseIso(value?: string): number {
  if (!value) return Date.now();
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Date.now();
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** `x:bearerToken` → `X_BEARER_TOKEN` (app credential name → env var name). */
function envKey(credential: string): string {
  const [platform = "", ...rest] = credential.split(":");
  const name = rest.join("_");
  const snake = name
    .replace(/[A-Z]/g, (c) => `_${c}`)
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase();
  return `${platform.toUpperCase()}_${snake}`.replace(/_+/g, "_").replace(/^_|_$/g, "");
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}