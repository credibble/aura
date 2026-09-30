import { describe, it, expect, vi } from "vitest";
import { padToN, clampInt, bucketSec } from "../src/jobs/utils";
import { auraJobId, feedJobId, windowJobId } from "../src/jobs/queue.constants";
import { SourceCacheService } from "../src/jobs/source-cache/source-cache.service";
import { parseMarketStyle, windowMetadata, gainBetween, CATEGORY_BASE } from "../src/jobs/window/market-style";

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

describe("market-style category taxonomy", () => {
  it("decodes {cat}_{sub}_{format} codes into the market style", () => {
    const sport = parseMarketStyle(100_000_000)!;
    expect(sport.base).toEqual("sport");
    expect(sport.style).toEqual("binary");

    // football binary — 100_001_001
    const arsenal = parseMarketStyle(100_001_001)!;
    expect(arsenal.cat).toEqual(CATEGORY_BASE);
    expect(arsenal.sub).toEqual(100_001_000);
    expect(arsenal.format).toEqual(1);
    expect(arsenal.style).toEqual("binary");
    expect(arsenal.subLabel).toEqual("football");

    // football multi-outcome — 100_001_002
    const league = parseMarketStyle(100_001_002)!;
    expect(league.format).toEqual(2);
    expect(league.style).toEqual("multi");

    // basket_ball binary — 100_002_001
    expect(parseMarketStyle(100_002_001)!.subLabel).toEqual("basket_ball");
  });

  it("rejects malformed codes", () => {
    expect(parseMarketStyle(0)).toBeNull();
    expect(parseMarketStyle(100_001_003)).toBeNull(); // bad format
    expect(parseMarketStyle(1_000)).toBeNull();
  });

  it("derives the oracle window question + metadata from the category", () => {
    // @arsenal (football binary) with aura 3040 (1e2) → "rise above 30.40?"
    const style = parseMarketStyle(100_001_001)!;
    const meta = JSON.parse(windowMetadata("arsenal", style, 3040)) as Record<string, unknown>;
    expect(meta.question).toEqual("Will @arsenal aura rise above 30.40?");
    expect(meta.style).toEqual("binary");
    expect(meta.category).toEqual(100_001_001);
    expect(meta.sub).toEqual("football");

    // Multi (football group) asks about the aura GAINED over the window — not %.
    const multi = JSON.parse(
      windowMetadata("football", parseMarketStyle(100_001_002)!, 3000),
    ) as Record<string, unknown>;
    expect(multi.question).toEqual("Who will gain the highest aura from window start to end?");
    expect(multi.style).toEqual("multi");
  });



  it("gain math: absolute aura gained between 1e2 levels", () => {
    expect(gainBetween(3000, 3040)).toEqual(40); // 30.00 → 30.40 = +0.40 aura
    expect(gainBetween(3000, 3000)).toEqual(0);
    expect(gainBetween(0, 1000)).toEqual(1000); // pure subtraction — open 0 is fine
    expect(gainBetween(3040, 3000)).toEqual(-40); // a loss is a negative gain
  });
});