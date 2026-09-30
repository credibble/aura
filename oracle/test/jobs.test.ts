import { describe, it, expect, vi } from "vitest";
import { padToN, clampInt, bucketSec } from "../src/jobs/utils";
import { auraJobId, feedJobId, windowJobId } from "../src/jobs/queue.constants";
import { SourceCacheService } from "../src/jobs/source-cache/source-cache.service";
import { marketStyle, windowMetadata, gainBetween } from "../src/jobs/window/market-style";
import {
  FeedEngineService,
  digestCounters,
  fallbackDraft,
  groupStories,
  normalizeTitle,
  type Story,
  type StorySource,
} from "../src/jobs/feed/feed-engine.service";
import type { RawDatum } from "../src/core/domain/source-item";
import type { AuraHandle } from "../src/jobs/jobs.types";

describe("job utils", () => {
  it("padToN right-pads a fresh series with its first value (new-source rule)", () => {
    // A brand-new source (1 data point) is repeated N times so the AI sees a
    // steady baseline and aura never spikes on a fresh source.
    expect(padToN([42], 5)).toEqual([42, 42, 42, 42, 42]);
    expect(padToN([1, 2], 4)).toEqual([1, 2, 2, 2]);
  });

  it("padToN truncates to the last N and handles empty", () => {
    expect(padToN([1, 2, 3, 4, 5, 6], 3)).toEqual([4, 5, 6]);
    expect(padToN([], 5)).toEqual([]);
  });

  it("clampInt rounds and bounds to [min, max]", () => {
    expect(clampInt(499.6, 0, 10_000)).toEqual(500);
    expect(clampInt(-5, 0, 10_000)).toEqual(0);
    expect(clampInt(1e9, 0, 10_000)).toEqual(10_000);
    expect(clampInt(Number.NaN, 0, 10_000)).toEqual(0);
  });

  it("bucketSec aligns a timestamp to the scheduler interval", () => {
    expect(bucketSec(10_000, 10_000)).toEqual(1);
    expect(bucketSec(10_000 + 1, 10_000)).toEqual(1);
    expect(bucketSec(19_999, 10_000)).toEqual(1);
    expect(bucketSec(20_000, 10_000)).toEqual(2);
  });
});

describe("job ids", () => {
  it("are deterministic and namespaced per bucket", () => {
    expect(auraJobId("0xabc", 7)).toEqual("aura:0xabc:7");
    expect(feedJobId("0xabc", 3)).toEqual("feed:0xabc:3");
    expect(windowJobId("0xabc", 1234)).toEqual("window:0xabc:1234");
  });
});

describe("SourceCacheService", () => {
  function fakeRedis() {
    const store = new Map<string, string>();
    return {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      expire: vi.fn(async () => 1),
    };
  }

  it("builds the namespaced cache key source:<platform>:<account>:@<handle>", () => {
    const svc = new SourceCacheService(fakeRedis() as never);
    expect(svc.key({ namespace: "shopify", account: "me", handle: "devar" })).toEqual(
      "source:shopify:me:@devar",
    );
  });

  it("wrap fetches once then serves the cached payload", async () => {
    const redis = fakeRedis();
    const svc = new SourceCacheService(redis as never);
    const key = { namespace: "github", account: "devar", handle: "devar" };
    const fetch = vi.fn(async () => ({ stars: 12 }));

    const first = await svc.wrap(key, 300, fetch);
    const second = await svc.wrap(key, 300, fetch);

    expect(first).toEqual({ stars: 12 });
    expect(second).toEqual({ stars: 12 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
  });
});

describe("market style from the category code", () => {
  it("carries the primary category code into the binary market style", () => {
    expect(marketStyle(3)).toEqual({ category: 3, style: "binary" });
    expect(marketStyle(9).category).toEqual(9);
  });

  it("leaves unknown/zero codes at 0 rather than inventing a family", () => {
    expect(marketStyle(0)).toEqual({ category: 0, style: "binary" });
    expect(marketStyle(-1).category).toEqual(0);
    expect(marketStyle(Number.NaN).category).toEqual(0);
  });

  it("derives the oracle window question + metadata from the category", () => {
    // @arsenal (sports, code 3) with aura 3040 (1e2) → "rise above 30.40?"
    const meta = JSON.parse(windowMetadata("arsenal", marketStyle(3), 3040)) as Record<string, unknown>;
    expect(meta.question).toEqual("Will @arsenal aura rise above 30.40?");
    expect(meta.style).toEqual("binary");
    expect(meta.category).toEqual(3);
    expect(meta.strike).toEqual(3040);
  });
  it("gain math: absolute aura gained between 1e2 levels", () => {
    expect(gainBetween(3000, 3040)).toEqual(40); // 30.00 → 30.40 = +0.40 aura
    expect(gainBetween(3000, 3000)).toEqual(0);
    expect(gainBetween(0, 1000)).toEqual(1000); // pure subtraction — open 0 is fine
    expect(gainBetween(3040, 3000)).toEqual(-40); // a loss is a negative gain
  });
});

describe("feed story dedupe", () => {
  const source = (id: string, label = id, account = label, platform = "news"): StorySource => ({
    id,
    label,
    account,
    platform,
  });
  const item = (text: string, engagement?: number): RawDatum => ({
    sourceName: "feed",
    text,
    publishedAt: 1_000,
    ...(engagement === undefined ? {} : { engagement }),
  });

  it("normalizes case, punctuation and trailing outlet credits", () => {
    // Casefold + possessive + punctuation.
    expect(normalizeTitle("Tesla's stock jumps 5%!")).toBe("tesla stock jumps 5");
    // "… - Not a Tesla App" and "… | Reuters" peel off to the same story.
    const fromGnews = normalizeTitle("Tesla's Robotaxi rollout in Austin begins - Not a Tesla App");
    const fromReuters = normalizeTitle("Tesla's Robotaxi rollout in Austin begins | Reuters");
    expect(fromGnews).toBe("tesla robotaxi rollout in austin begins");
    expect(fromGnews).toBe(fromReuters);
    // "… — …" (a truncated suffix after an em-dash) peels too.
    expect(normalizeTitle("Tesla teases Robotaxi — …")).toBe("tesla teases robotaxi");
  });

  it("keeps a lowercase dash clause as part of the story (not an outlet)", () => {
    expect(normalizeTitle("Tesla cuts prices - what it means for buyers")).toBe(
      "tesla cuts prices what it means for buyers",
    );
  });

  it("collapses the same story from two feeds into one item with both sources", () => {
    const stories = groupStories([
      {
        source: source("rss-gnews-tesla", "Google News · Tesla"),
        items: [item("Tesla Robotaxi rollout begins in Austin - Not a Tesla App")],
      },
      {
        source: source("rss-teslarati", "Teslarati"),
        items: [item("Tesla Robotaxi rollout begins in Austin | Teslarati")],
      },
    ]);
    expect(stories).toHaveLength(1);
    expect(stories[0]!.items).toHaveLength(2);
    expect(stories[0]!.sources.map((s) => s.id)).toEqual(["rss-gnews-tesla", "rss-teslarati"]);
    // The representative is a REAL item — the headline is never rewritten.
    expect(stories[0]!.rep.text).toBe("Tesla Robotaxi rollout begins in Austin - Not a Tesla App");
  });

  it("keeps different stories apart and picks the highest-reach representative", () => {
    const stories = groupStories([
      {
        source: source("a"),
        items: [
          item("Tesla robotaxi lands in Austin - Reuters", 120),
          item("Tesla opens a new Gigafactory in Mexico", 10),
        ],
      },
      { source: source("b"), items: [item("Tesla robotaxi lands in Austin | Not a Tesla App", 4_500)] },
    ]);
    expect(stories).toHaveLength(2);
    const robotaxi = stories[0]!;
    expect(robotaxi.sources.map((s) => s.id)).toEqual(["a", "b"]);
    expect(robotaxi.rep.engagement).toBe(4_500); // highest reach wins
    expect(robotaxi.repSource.id).toBe("b");
    expect(robotaxi.rep.text).toBe("Tesla robotaxi lands in Austin | Not a Tesla App");
  });

  it("fallback reports distinct stories and names the sources — never the headline", () => {
    const draft = fallbackDraft("tesla", 1, ["Google News · Tesla", "Teslarati"]);
    expect(draft.title).toBe("@tesla: 1 new story from 2 sources");
    expect(draft.body).toBe("1 new story on @tesla across Google News · Tesla and Teslarati.");
    expect(draft.body).not.toContain("Robotaxi"); // no verbatim headline
    expect(draft.body).not.toContain("\n"); // still a single line
    expect(draft.change).toBe(0);
  });

  it("fallback pluralizes and caps a long source list", () => {
    const draft = fallbackDraft("tesla", 3, ["A", "B", "C", "D", "E"]);
    expect(draft.title).toBe("@tesla: 3 new stories from 5 sources");
    expect(draft.body).toBe("3 new stories on @tesla across A, B, C, D and 1 more.");
  });

  it("end to end: two items that differ only by outlet suffix → 1 story / 2 sources", () => {
    const stories = groupStories([
      {
        source: source("rss-gnews-tesla", "Google News · Tesla"),
        items: [item("Tesla Robotaxi rollout begins in Austin - Not a Tesla App")],
      },
      {
        source: source("rss-teslarati", "Teslarati"),
        items: [item("Tesla Robotaxi rollout begins in Austin | Teslarati")],
      },
    ]);
    const sources = new Map(stories.flatMap((s) => s.sources).map((s) => [s.id, s] as const));
    expect(stories).toHaveLength(1); // distinct stories
    expect(sources.size).toBe(2); // contributing sources
    const draft = fallbackDraft("tesla", stories.length, [...sources.values()].map((s) => s.label));
    expect(draft.body).toBe("1 new story on @tesla across Google News · Tesla and Teslarati.");
  });

  it("run(): the fallback is a distinct-story count and the card merges both sources", async () => {
    const gnews = "Tesla Robotaxi rollout begins in Austin - Not a Tesla App";
    const teslarati = "Tesla Robotaxi rollout begins in Austin | Teslarati";
    const sources = [
      {
        id: "rss-gnews-tesla", kind: "media" as const, weight: 840, fetchIntervalMs: 300_000,
        label: "Google News · Tesla", transport: { type: "rss" as const, feedUrl: "https://example.test/gnews" },
      },
      {
        id: "rss-teslarati", kind: "media" as const, weight: 840, fetchIntervalMs: 300_000,
        label: "Teslarati", transport: { type: "rss" as const, feedUrl: "https://example.test/teslarati" },
      },
    ];
    const itemsBySource: Record<string, RawDatum[]> = {
      "rss-gnews-tesla": [{ sourceName: "gnews", text: gnews, publishedAt: 9_000 }],
      "rss-teslarati": [{ sourceName: "teslarati", text: teslarati, publishedAt: 9_500 }],
    };
    const built: { input: { newItemCount: number }; fallback: { title: string; body: string } }[] = [];
    const persisted: { sources: { id: string; account: string }[] }[] = [];
    const engine = new FeedEngineService(
      { get: () => undefined } as never,
      { fetch: async (source: { id: string }) => itemsBySource[source.id] ?? [] } as never,
      { wrap: async (_key: unknown, _ttl: number, fn: () => Promise<RawDatum[]>) => fn() } as never,
      { publishFeed: vi.fn() } as never,
      {
        build: async (input: { newItemCount: number }, fallback: { title: string; body: string }) => {
          built.push({ input, fallback });
          return fallback; // simulate "model unavailable" → the fallback is published
        },
      } as never,
      {
        post: {
          create: async ({ data }: { data: { sources: { id: string; account: string }[] } }) => {
            persisted.push(data);
          },
        },
      } as never,
      { get: async () => null, set: async () => "OK" } as never,
      { sourcesForHandle: async () => sources } as never,
    );
    const handle: AuraHandle = {
      id: "0x7465736c61000000000000000000000000000000000000000000000000000000",
      label: "tesla", contract: "0x0", sources: [], aura: 2360, graduated: true, categories: [5, 1], windowMinutes: 60,
    };

    const feed = await engine.run(handle, 1_000_000);
    expect(feed).not.toBeNull();
    expect(built[0]!.input.newItemCount).toBe(1); // distinct stories, not 2 raw items
    expect(built[0]!.fallback.body).toBe("1 new story on @tesla across Google News · Tesla and Teslarati.");
    expect(feed!.body).toBe("1 new story on @tesla across Google News · Tesla and Teslarati.");
    // ONE merged card entry, attributed to both sources; no headline quote.
    expect(persisted[0]!.sources).toHaveLength(1);
    expect(persisted[0]!.sources[0]!.id).toBe("rss-gnews-tesla+rss-teslarati");
    expect(persisted[0]!.sources[0]!.account).toBe("Google News · Tesla · Teslarati");
  });
});

describe("feed digest engagement (reported, never fabricated)", () => {
  const storyFor = (stats?: Record<string, number>): Story => {
    const rep: RawDatum = {
      sourceName: "s",
      text: "story",
      publishedAt: 1_000,
      ...(stats ? { stats } : {}),
    };
    const src: StorySource = { id: "s", label: "S", account: "S", platform: "news" };
    return { rep, repSource: src, sources: [src], items: [rep] };
  };

  it("omits every counter when no source reported engagement (RSS)", () => {
    expect(digestCounters([storyFor()])).toEqual({});
  });

  it("passes a genuinely reported 0 through as 0 and ignores non-card keys", () => {
    expect(digestCounters([storyFor({ likes: 0, followers: 120, score: 4 })])).toEqual({ likes: 0 });
  });

  it("pools only the four card counters across stories", () => {
    expect(
      digestCounters([storyFor({ likes: 3, score: 9 }), storyFor({ likes: 4, views: 10 })]),
    ).toEqual({ likes: 7, views: 10 });
  });

  /** Run the digest over one source and return the persisted Post row. */
  async function persist(items: RawDatum[]): Promise<Record<string, unknown>> {
    const sources = [
      {
        id: "src", kind: "media" as const, weight: 800, fetchIntervalMs: 300_000,
        label: "Source", transport: { type: "rss" as const, feedUrl: "https://example.test/feed" },
      },
    ];
    const rows: Record<string, unknown>[] = [];
    const engine = new FeedEngineService(
      { get: () => undefined } as never,
      { fetch: async () => items } as never,
      { wrap: async (_key: unknown, _ttl: number, fn: () => Promise<RawDatum[]>) => fn() } as never,
      { publishFeed: vi.fn() } as never,
      { build: async (_input: unknown, fallback: { title: string; body: string }) => fallback } as never,
      {
        post: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            rows.push(data);
          },
        },
      } as never,
      { get: async () => null, set: async () => "OK" } as never,
      { sourcesForHandle: async () => sources } as never,
    );
    const handle: AuraHandle = {
      id: "0x7465736c61000000000000000000000000000000000000000000000000000000",
      label: "tesla", contract: "0x0", sources: [], aura: 2360, graduated: true, categories: [5, 1], windowMinutes: 60,
    };
    await engine.run(handle, 1_000_000);
    return rows[0]!;
  }

  it("persists NO counter keys for an RSS digest — nothing was reported", async () => {
    const row = await persist([{ sourceName: "rss", text: "Tesla robotaxi launches", publishedAt: 9_000 }]);
    for (const key of ["replies", "reposts", "likes", "views"]) {
      expect(row).not.toHaveProperty(key);
    }
  });

  it("persists a reported counter, keeping a genuine 0 as 0", async () => {
    const row = await persist([
      {
        sourceName: "x",
        text: "Tesla robotaxi launches",
        publishedAt: 9_000,
        stats: { likes: 0, reposts: 5, followers: 900 },
      },
    ]);
    expect(row.likes).toBe(0); // a measured zero survives
    expect(row.reposts).toBe(5);
    expect(row).not.toHaveProperty("replies");
    expect(row).not.toHaveProperty("views");
  });
});
