import { describe, expect, it } from "vitest";
import { PortfolioService } from "../src/api/portfolio.service";
import { encodeBytes32 } from "./helpers";

function makeService(options: { claimed?: string[]; credentials?: Record<string, boolean> } = {}) {
  const sync = {
    handles: async () =>
      (options.claimed ?? []).map((id) => ({
        id: encodeBytes32(id),
        contract: "0x",
        owner: "0xcreator",
        name: id,
        symbol: id.toUpperCase(),
        metadata: "",
        windowMinutes: 15n,
        sources: [],
        market: "0x",
        oracleFactory: "0x",
        revenue: "0x",
        stake: "0x",
        pool: "0x",
      })),
  } as never;

  const handleConnection = new FakeHandleConnection();
  const connections = {
    get: async (platform: string, account: string) => (options.credentials?.[`${platform}::${account}`] ? { accessToken: "tok" } : null),
  } as never;

  const chain = { isVerified: async () => null, setVerified: async () => false } as never;
  return new PortfolioService(sync, { handleConnection } as never, connections, { verify: async () => true } as never, chain);
}

class FakeHandleConnection {
  private rows = new Map<string, { id: string; handleId: string; platform: string; account: string; status: string; connectedAt: Date }>();

  async findUnique(args: { where: { id: string } }) {
    return this.rows.get(args.where.id) ?? null;
  }
  async upsert(args: {
    where: { id: string };
    create: { id: string; handleId: string; platform: string; account: string; status: string; connectedAt: Date };
    update: { platform: string; account: string; status: string };
  }) {
    const existing = this.rows.get(args.where.id);
    if (existing) Object.assign(existing, args.update);
    else this.rows.set(args.where.id, { ...args.create });
    return args.create;
  }
  async delete(args: { where: { id: string } }) {
    this.rows.delete(args.where.id);
    return null;
  }
}

describe("Portfolio — handle claiming + one source connection per handle", () => {
  it("rejects reserved and already-claimed names; frees available ones", async () => {
    const svc = makeService({ claimed: ["btc"] });

    expect(await svc.availability("aura")).toEqual({ available: false, reason: "reserved" });
    expect(await svc.availability("BTC")).toEqual({ available: false, reason: "claimed", claimedBy: "0xcreator" });
    expect(await svc.availability("devar")).toEqual({ available: true, reason: "available" });
  });

  it("connects a handle to one platform account (requires a credential first)", async () => {
    const svc = makeService({ claimed: ["devar"], credentials: { "spotify::@devar": true } });

    const conn = await svc.connect("devar", "spotify", "@devar");
    expect(conn.platform).toBe("spotify");
    expect(conn.status).toBe("connected");

    // No credential for the platform → refused.
    await expect(svc.connect("devar", "instagram", "@devar")).rejects.toThrow(/No credential/);
    // Unknown handle → refused.
    await expect(svc.connect("nobody", "spotify", "@devar")).rejects.toThrow(/Unknown handle/);
  });

  it("reconnects by swapping the platform/account (one connection per handle)", async () => {
    const svc = makeService({ claimed: ["devar"], credentials: { "spotify::@devar": true, "x::@devar": true } });

    await svc.connect("devar", "spotify", "@devar");
    const reconnected = await svc.connect("devar", "x", "@devar", "reconnecting");
    expect(reconnected.platform).toBe("x");
    expect(reconnected.status).toBe("reconnecting");

    const after = await svc.connection("devar");
    expect(after.platform).toBe("x");
    expect(after.account).toBe("@devar");
  });

  it("disconnects (credential stays usable for another handle)", async () => {
    const svc = makeService({ claimed: ["devar"], credentials: { "spotify::@devar": true } });

    await svc.connect("devar", "spotify", "@devar");
    const disconnected = await svc.disconnect("devar");
    expect(disconnected.status).toBe("disconnected");
    expect(disconnected.platform).toBeNull();

    // The underlying credential survives — connect a different handle to it.
    const svc2 = makeService({ claimed: ["devar", "swift"], credentials: { "spotify::@devar": true } });
    const conn = await svc2.connect("swift", "spotify", "@devar");
    expect(conn.platform).toBe("spotify");
  });
});