import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvioClient } from "../src/envio";
import { SubgraphClient } from "../src/client";
import { bytes32ToId } from "../src/index";

function mockFetch(routes: Record<string, unknown>): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [needle, body] of Object.entries(routes)) {
      if (url.includes(needle)) {
        if (body instanceof Response) return body;
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response("{}", { status: 200 });
  }));
}

afterEach(() => vi.unstubAllGlobals());

const HANDLE = {
  id: "0x6274630000000000000000000000000000000000000000000000000000000000",
  contract: "0xH",
  owner: "0xowner",
  name: "Bitcoin",
  symbol: "BTC",
  metadata: "",
  market: "0xM",
  oracleFactory: "0xO",
  revenue: "0xR",
  stake: "0xS",
  pool: "0xP",
  sources: ['{"platform":"github","username":"bitcoin"}'],
  aura: "8500",
  windowMinutes: "15",
  active: true,
  windowCount: 3,
};

const WINDOW = {
  id: "0x6274630000000000000000000000000000000000000000000000000000000000-1777000000",
  handle: HANDLE.id,
  oracle: "0xwo",
  handleId: HANDLE.id,
  windowStart: "1777000000",
  windowEnd: "1777003600",
  strike: "5000",
  outcomes: ["YES", "NO"],
  liquidity: "1442695040888963407",
  q: ["1000000000000000000", "1000000000000000000"],
  reference: "5100",
  timestamp: "1777000000",
  cash: "100000000000000000000000",
  settled: false,
  winningOutcome: null,
  finalIndex: [],
  reserved: "100000000000000000000000",
  paidOut: "0",
};

describe("SubgraphClient", () => {
  it("queries handles and decodes bytes32 ids", async () => {
    mockFetch({ "graph.aura.xyz": { data: { handles: [HANDLE] } } });
    const client = new SubgraphClient({ url: "https://graph.aura.xyz" });
    const handles = await client.handles();
    expect(handles[0]!.symbol).toBe("BTC");
    expect(bytes32ToId(handles[0]!.id)).toBe("btc");
    expect(handles[0]!.aura).toBe("8500");
  });

  it("queries a handle's sources", async () => {
    mockFetch({ "graph.aura.xyz": { data: { handle: HANDLE } } });
    const client = new SubgraphClient({ url: "https://graph.aura.xyz" });
    const handle = await client.handle(HANDLE.id);
    expect(handle?.sources).toEqual(['{"platform":"github","username":"bitcoin"}']);
  });

  it("resolves windows by oracle address", async () => {
    mockFetch({ "graph.aura.xyz": { data: { oracleWindow: { id: "0xwo", window: WINDOW } } } });
    const client = new SubgraphClient({ url: "https://graph.aura.xyz" });
    const win = await client.windowByOracle("0xwo");
    expect(win?.id).toBe(WINDOW.id);
    expect(win?.outcomes).toEqual(["YES", "NO"]);
    expect(win?.winningOutcome).toBeNull();
  });

  it("lists a maker's orders and a user's trades with pagination", async () => {
    mockFetch({
      "graph.aura.xyz": { data: { orders: [{ id: "o1", window: WINDOW.id, maker: "0xmaker", outcome: 0, side: true, price: "500000000000000000", size: "1000000000000000000", filled: "0", expiresAt: "0", status: "ACTIVE", createdAt: "1777000000" }] } },
    });
    const client = new SubgraphClient({ url: "https://graph.aura.xyz" });
    const orders = await client.ordersByMaker("0xmaker", { first: 10, skip: 0 });
    expect(orders[0]!.maker).toBe("0xmaker");
    expect(orders[0]!.outcome).toBe(0);
  });
});

describe("EnvioClient (HyperIndex / HyperSync / HyperRPC)", () => {
  it("reads handles via HyperIndex GraphQL", async () => {
    mockFetch({ "envio-indexer.xyz": { data: { handles: [HANDLE] } } });
    const envio = new EnvioClient({ url: "https://envio-indexer.xyz" });
    const handles = await envio.handles();
    expect(handles[0]!.name).toBe("Bitcoin");
  });

  it("queries indexed responses via HyperSync", async () => {
    mockFetch({ "hypersync.xyz/v1/query": { responses: [{ id: "ev-1" }] } });
    const envio = new EnvioClient({ hyperSyncUrl: "https://hypersync.xyz", contractAddress: "0xM" });
    const rows = await envio.hyperSync({ queries: [{ field: "address" }] });
    expect(rows).toEqual([{ id: "ev-1" }]);
  });

  it("fetches logs via HyperRPC", async () => {
    mockFetch({ "hyperrpc.xyz": { result: [{ topic: "0x1234" }] } });
    const envio = new EnvioClient({ hyperRpcUrl: "https://hyperrpc.xyz", contractAddress: "0xM" });
    const logs = await envio.logs(["0x1234"], 0n, 100n);
    expect(logs).toEqual([{ topic: "0x1234" }]);
  });

  it("throws when an Envio endpoint is not configured", async () => {
    const envio = new EnvioClient({});
    await expect(envio.handles()).rejects.toThrow(/ENVIO_URL/);
  });
});