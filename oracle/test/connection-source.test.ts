import { describe, expect, it } from "vitest";
import {
  connectionSourceConfig,
  connectionSourceJson,
  connectionPlatformOf,
  isConnectionSource,
} from "../src/api/connection-source";
import { PortfolioService } from "../src/api/portfolio.service";
import { encodeBytes32 } from "./helpers";

const SPOTIFY = connectionSourceJson("spotify", "0xhandle")!;

describe("connection-source — canonical on-chain config", () => {
  it("builds a per-platform config keyed by the credential account", () => {
    expect(connectionSourceConfig("spotify", "0xabc")).toEqual({
      platform: "spotify",
      variant: "me",
      account: "0xabc",
    });
    expect(connectionSourceConfig("instagram", "0xabc")).toEqual({
      platform: "instagram",
      account: "0xabc",
      username: "0xabc",
    });
    expect(connectionSourceConfig("shopify", "my-store")).toEqual({
      platform: "shopify",
      account: "my-store",
      shop: "my-store",
    });
  });

  it("returns null for a platform with no per-user adapter", () => {
    expect(connectionSourceJson("x", "0xabc")).toBeNull();
    expect(connectionSourceJson("youtube", "0xabc")).toBeNull();
  });

  it("matches a source by platform + account, ignoring unrelated sources", () => {
    expect(isConnectionSource(SPOTIFY, "spotify", "0xhandle")).toBe(true);
    expect(isConnectionSource(SPOTIFY, "spotify", "0xother")).toBe(false);
    expect(isConnectionSource(SPOTIFY, "instagram", "0xhandle")).toBe(false);
    // A seeded RSS feed is not a connection source.
    const rss = JSON.stringify({ platform: "rss", feed: "https://example.com" });
    expect(isConnectionSource(rss, "spotify", "0xhandle")).toBe(false);
    expect(connectionPlatformOf(rss)).toBeNull();
    expect(connectionPlatformOf(SPOTIFY)).toBe("spotify");
  });
});

/** Fake chain gateway recording source writes. */
function makeChain(initial: string[] = []) {
  const sources = [...initial];
  const adds: string[] = [];
  const removals: number[] = [];
  return {
    ready: true,
    adds,
    removals,
    sources,
    isVerified: async () => null,
    setVerified: async () => false,
    handleSources: async () => [...sources],
    addSource: async (_contract: string, json: string) => {
      adds.push(json);
      if (!sources.includes(json)) sources.push(json);
      return true;
    },
    removeSource: async (_contract: string, index: number) => {
      removals.push(index);
      sources.splice(index, 1);
      return true;
    },
  };
}

function makeService(options: {
  claimed?: string[];
  credentials?: Record<string, boolean>;
  chainSources?: string[];
} = {}) {
  const sync = {
    handles: async () =>
      (options.claimed ?? []).map((id) => ({
        id: encodeBytes32(id),
        contract: `0xhandle-${id}`,
        owner: "0xcreator",
        name: id,
        symbol: id.toUpperCase(),
        metadata: "",
        windowMinutes: 15n,
        sources: [...(options.chainSources ?? [])],
        market: "0x",
        oracleFactory: "0x",
        revenue: "0x",
        stake: "0x",
        pool: "0x",
      })),
  } as never;

  const rows = new Map<string, { id: string; handleId: string; platform: string; account: string; status: string; connectedAt: Date }>();
  const prisma = {
    handleConnection: {
      findUnique: async (args: { where: { id: string } }) => rows.get(args.where.id) ?? null,
      upsert: async (args: {
        where: { id: string };
        create: { id: string; handleId: string; platform: string; account: string; status: string; connectedAt: Date };
        update: { platform: string; account: string; status: string };
      }) => {
        const existing = rows.get(args.where.id);
        if (existing) Object.assign(existing, args.update);
        else rows.set(args.where.id, { ...args.create });
        return args.create;
      },
      delete: async (args: { where: { id: string } }) => {
        rows.delete(args.where.id);
        return null;
      },
    },
  } as never;

  const connections = {
    get: async (platform: string, account: string) =>
      options.credentials?.[`${platform}::${account}`] ? { accessToken: "tok" } : null,
  } as never;

  const chain = makeChain(options.chainSources);
  const config = { get: () => 0 } as never;
  const svc = new PortfolioService(
    sync,
    prisma,
    connections,
    { verify: async () => true } as never,
    chain as never,
    config,
  );
  return { svc, chain };
}

describe("Portfolio — the connection mirrors Handle.sources[] on-chain", () => {
  it("adds the connection source on connect", async () => {
    const { svc, chain } = makeService({
      claimed: ["devar"],
      credentials: { "spotify::0xhandle-devar": true },
    });

    await svc.connect(encodeBytes32("devar"), "spotify", "0xhandle-devar");

    expect(chain.adds).toEqual([
      JSON.stringify({ platform: "spotify", variant: "me", account: "0xhandle-devar" }),
    ]);
    expect(chain.removals).toEqual([]);
  });

  it("swaps the old platform's source for the new one on reconnect (one connection)", async () => {
    const spotify = JSON.stringify({ platform: "spotify", variant: "me", account: "0xhandle-devar" });
    const { svc, chain } = makeService({
      claimed: ["devar"],
      credentials: { "spotify::0xhandle-devar": true, "instagram::0xhandle-devar": true },
      chainSources: ["rss-seeded", spotify],
    });

    await svc.connect(encodeBytes32("devar"), "spotify", "0xhandle-devar");
    await svc.connect(encodeBytes32("devar"), "instagram", "0xhandle-devar", "reconnecting");

    // The seeded feed is untouched; only the spotify entry is removed.
    expect(chain.removals).toEqual([1]);
    expect(chain.adds).toContain(
      JSON.stringify({ platform: "instagram", account: "0xhandle-devar", username: "0xhandle-devar" }),
    );
    expect(chain.sources).toContain("rss-seeded");
    expect(chain.sources).not.toContain(spotify);
  });

  it("removes the source on disconnect", async () => {
    const spotify = JSON.stringify({ platform: "spotify", variant: "me", account: "0xhandle-devar" });
    const { svc, chain } = makeService({
      claimed: ["devar"],
      credentials: { "spotify::0xhandle-devar": true },
      chainSources: ["rss-seeded", spotify],
    });

    await svc.connect(encodeBytes32("devar"), "spotify", "0xhandle-devar");
    await svc.disconnect(encodeBytes32("devar"));

    expect(chain.removals).toEqual([1]);
    expect(chain.sources).toEqual(["rss-seeded"]);
  });

  it("repairs drift: reconciles a stale source and a missing connection source", async () => {
    const stale = JSON.stringify({ platform: "spotify", variant: "me", account: "0xhandle-devar" });
    const { svc, chain } = makeService({
      claimed: ["devar"],
      credentials: { "spotify::0xhandle-devar": true, "instagram::0xhandle-devar": true },
      chainSources: ["rss-seeded", stale],
    });

    // Row says the handle is connected to instagram, but the chain still carries
    // the old spotify source — reconcile must drop it and add the right one.
    await svc.connect(encodeBytes32("devar"), "instagram", "0xhandle-devar");
    chain.sources.length = 0;
    chain.sources.push("rss-seeded", stale);
    chain.adds.length = 0;
    chain.removals.length = 0;

    await svc.reconcileSources();

    expect(chain.removals).toEqual([1]);
    expect(chain.adds).toEqual([
      JSON.stringify({ platform: "instagram", account: "0xhandle-devar", username: "0xhandle-devar" }),
    ]);
    expect(chain.sources).toContain("rss-seeded");
  });
});
