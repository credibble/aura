import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry } from "../src/adapters/adapter-registry.service";
import { SpotifyConnectAdapter } from "../src/adapters/connections/spotify-connect.adapter";
import { ShopifyConnectAdapter } from "../src/adapters/connections/shopify-connect.adapter";
import { RssFeedAdapter } from "../src/adapters/public/rss-feed.adapter";
import { GitHubProfileAdapter } from "../src/adapters/api/github-profile.adapter";
import { RedditSearchAdapter } from "../src/adapters/public/reddit-search.adapter";
import { PrismaTimeSeriesStore } from "../src/adapters/prisma-time-series.service";

/** Fake `metricPoint` Prisma delegate for the store tests. */
class FakeMetricPointModel {
  private rows: { id: string; sourceId: string; metric: string; value: number; delta: number | null; timestamp: Date }[] = [];

  async upsert(args: {
    where: { sourceId_metric_timestamp: { sourceId: string; metric: string; timestamp: Date } };
    create: { id: string; sourceId: string; metric: string; value: number; delta: number | null; timestamp: Date };
    update: { value: number; delta: number | null };
  }): Promise<unknown> {
    const { sourceId, metric, timestamp } = args.where.sourceId_metric_timestamp;
    const row = this.rows.find((r) => r.sourceId === sourceId && r.metric === metric && r.timestamp.getTime() === timestamp.getTime());
    if (row) {
      row.value = args.update.value;
      row.delta = args.update.delta;
    } else this.rows.push({ ...args.create });
    return args.create;
  }

  async findMany(args: { where: { sourceId: string; metric: string; timestamp?: { gte?: Date; lte?: Date } }; orderBy: { timestamp: "asc" } }) {
    const { sourceId, metric, timestamp } = args.where;
    return this.rows
      .filter((r) => r.sourceId === sourceId && r.metric === metric && (timestamp?.gte === undefined || r.timestamp >= timestamp.gte) && (timestamp?.lte === undefined || r.timestamp <= timestamp.lte))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  async findFirst(args: { where: { sourceId: string; metric: string }; orderBy: { timestamp: "desc" } }) {
    const { sourceId, metric } = args.where;
    let best: typeof this.rows[number] | null = null;
    for (const r of this.rows) {
      if (r.sourceId === sourceId && r.metric === metric && (!best || r.timestamp > best.timestamp)) best = r;
    }
    return best;
  }
}

function makeStore(): PrismaTimeSeriesStore {
  return new PrismaTimeSeriesStore({ metricPoint: new FakeMetricPointModel() } as never);
}

/** Route fetch() by URL path against canned JSON responses. */
function mockFetch(routes: Record<string, unknown>): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [needle, body] of Object.entries(routes)) {
      if (url.includes(needle)) return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("AdapterRegistry — on-chain source JSON configs → real adapters", () => {
  const registry = new AdapterRegistry();

  it("resolves the registered platforms (X is intentionally absent)", () => {
    expect(registry.get("spotify", "me")).not.toBeNull();
    expect(registry.get("shopify")).not.toBeNull();
    expect(registry.get("github")).not.toBeNull();
    expect(registry.get("x", "timeline")).toBeNull(); // no free tier → removed
  });

  it("builds a Spotify me source from { platform, variant, account }", () => {
    const src = registry.buildFromJsonStrings(['{"platform":"spotify","variant":"me","account":"@dev"}']);
    expect(src).toHaveLength(1);
    expect(src[0]!.id).toBe("spotify-me-@dev");
    expect(src[0]!.metrics![0]!.key).toBe("followers");
  });

  it("ignores unknown platforms and invalid JSON", () => {
    expect(registry.buildFromJsonStrings(['{"platform":"tiktok","username":"x"}'])).toHaveLength(0);
    expect(registry.buildFromJsonStrings(["not json", ""])).toHaveLength(0);
  });

  it("every adapter has a distinct 1-1000 credibility weight", () => {
    const weights = registry.all().map((a) => a.weight);
    expect(weights.length).toBe(new Set(weights).size); // all distinct
    for (const w of weights) {
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(1000);
    }
  });
});

describe("Adapters — real API extraction (mocked responses)", () => {
  it("Spotify me: GET /v1/me → followers.total", async () => {
    mockFetch({ "api.spotify.com/v1/me": { followers: { total: 1024 } } });
    const sample = await new SpotifyConnectAdapter().fetch({ platform: "spotify", variant: "me", account: "@dev" }, 0, 5 * 60_000, { accessToken: "tok" });
    expect(sample.points.followers![0]!.value).toBe(1024);
  });

  it("Spotify profile: search → artist → followers/popularity + top tracks", async () => {
    mockFetch({
      "api.spotify.com/v1/search": { artists: { items: [{ id: "abc" }] } },
      "api.spotify.com/v1/artists/abc/top-tracks": {
        tracks: [{ id: "t1", name: "Banger", popularity: 88, external_urls: { spotify: "https://open.spotify.com/track/t1" }, album: { name: "Album" } }],
      },
      "api.spotify.com/v1/artists/abc": { followers: { total: 1000 }, popularity: 70 },
    });
    const sample = await new SpotifyConnectAdapter().fetch({ platform: "spotify", variant: "profile", artist: "dev" }, 0, 5 * 60_000, { accessToken: "tok" });
    expect(sample.points.followers![0]!.value).toBe(1000);
    expect(sample.points.popularity![0]!.value).toBe(70);
    // No `listeners`: Spotify never exposed that number — the adapter must not
    // invent a metric that moves the aura.
    expect(sample.points.listeners).toBeUndefined();
    // The top tracks ARE the text signal.
    expect(sample.items?.[0]?.text).toContain("Banger");
    expect(sample.items?.[0]?.author).toBe("dev");
  });

  it("Shopify: GraphQL revenue + REST counts", async () => {
    mockFetch({
      "graphql.json": { data: { orders: { edges: [{ node: { currentTotalPrice: "12.50" } }, { node: { currentTotalPrice: "7.00" } }] } } },
      "/orders/count.json": { count: 31 },
      "/customers/count.json": { count: 4 },
      "/products/count.json": { count: 120 },
    });
    const sample = await new ShopifyConnectAdapter().fetch({ platform: "shopify", shop: "nike" }, 0, 5 * 60_000, { accessToken: "tok" });
    expect(sample.points.sales![0]!.value).toBeCloseTo(19.5, 5);
    expect(sample.points.orders![0]!.value).toBe(31);
    expect(sample.points.customers![0]!.value).toBe(4);
    expect(sample.points.products![0]!.value).toBe(120);
  });

  it("GitHub: user + repos → followers/stars/repos", async () => {
    mockFetch({
      "api.github.com/users/dev/repos": [{ stargazers_count: 5 }, { stargazers_count: 8 }],
      "api.github.com/users/dev": { followers: 42, public_repos: 2 },
    });
    const sample = await new GitHubProfileAdapter().fetch({ platform: "github", username: "dev" }, 0, 5 * 60_000, { apiKey: "k" });
    expect(sample.points.followers![0]!.value).toBe(42);
    expect(sample.points.stars![0]!.value).toBe(13);
    expect(sample.points.repos![0]!.value).toBe(2);
  });

  it("Reddit: /r/{sub}/about + /new → subscribers/posts", async () => {
    mockFetch({
      "/about.json": { data: { subscribers: 12345, active_user_count: 900 } },
      "/new.json": { data: { children: [{}, {}] } },
    });
    const sample = await new RedditSearchAdapter().fetch({ platform: "reddit", subreddit: "crypto" }, 0, 5 * 60_000);
    expect(sample.points.subscribers![0]!.value).toBe(12345);
    expect(sample.points.posts![0]!.value).toBe(2);
  });

  it("BBC: RSS feed → article count", async () => {
    const rss = `<?xml version="1.0" encoding="UTF-8"?><rss><channel><title>BBC</title>
      <item><title>One</title><pubDate>Thu, 01 Jan 2026 10:00:00 GMT</pubDate></item>
      <item><title>Two</title><pubDate>Thu, 01 Jan 2026 11:00:00 GMT</pubDate></item>
    </channel></rss>`;
    mockFetch({ "feeds.bbci.co.uk": rss });
    const sample = await new RssFeedAdapter().fetch({ platform: "rss", outlet: "bbc", weight: 900, feed: "https://feeds.bbci.co.uk/news/rss.xml" }, 0, 5 * 60_000);
    expect(sample.points.articles![0]!.value).toBeGreaterThanOrEqual(1);
  });

  it("adapters without credentials return an empty sample (no fake data)", async () => {
    const sample = await new ShopifyConnectAdapter().fetch({ platform: "shopify", shop: "nike" }, 0, 5 * 60_000);
    expect(sample.points).toEqual({});
  });
});

describe("TimeSeriesStore — Postgres-backed delta + chart", () => {
  it("computes per-entry deltas vs the previous entry (deltaListeners, …)", async () => {
    const series = makeStore();
    const t0 = 1_000_000;
    await series.appendSample("spotify-me-@dev", {
      followers: [
        { timestamp: t0, value: 100 },
        { timestamp: t0 + 300_000, value: 110 },
        { timestamp: t0 + 600_000, value: 121 },
      ],
    });

    const points = await series.points("spotify-me-@dev", "followers");
    expect(points).toHaveLength(3);
    expect(points[0]!.delta).toBeUndefined(); // first entry — no previous
    expect(points[1]!.delta).toBe(10); // 110 − 100
    expect(points[2]!.delta).toBe(11); // 121 − 110

    expect((await series.latest("spotify-me-@dev", "followers"))!.value).toBe(121);
    expect((await series.latest("spotify-me-@dev", "followers"))!.delta).toBe(11);
    expect(await series.pctChange("spotify-me-@dev", "followers", t0, t0 + 600_000)).toBeCloseTo(21, 5);
    const chart = await series.chart("spotify-me-@dev", "followers", t0, 600_000);
    expect(chart).toHaveLength(2);
    expect(chart[1]!.value).toBe(121);
  });

  it("same-bucket appends overwrite the point but keep the delta vs the prior entry", async () => {
    const series = makeStore();
    await series.append("spotify-me-@dev", "followers", { timestamp: 1000, value: 5 });
    await series.append("spotify-me-@dev", "followers", { timestamp: 2000, value: 7 });
    await series.append("spotify-me-@dev", "followers", { timestamp: 2000, value: 9 }); // overwrite same bucket
    const points = await series.points("spotify-me-@dev", "followers");
    expect(points).toEqual([
      { timestamp: 1000, value: 5, delta: undefined },
      { timestamp: 2000, value: 9, delta: 4 }, // 9 − 5 (prior entry, not the overwritten 7)
    ]);
  });
});