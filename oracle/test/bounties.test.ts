import { describe, expect, it } from "vitest";
import { CleanverseService } from "../src/api/cleanverse.service";
import { PortfolioService } from "../src/api/portfolio.service";
import { RpcService } from "../src/config/rpc.service";

function svc(required: string): CleanverseService {
  return new CleanverseService({ get: (k: string) => (k === "CLEANVERSE_REQUIRED" ? required : undefined) } as never);
}

/** PortfolioService wired with fake sync/chain — exercises verifyHandle only. */
function portfolio(owner: string, onChain: boolean | null) {
  const writes: { contract: string; ok: boolean }[] = [];
  const sync = {
    handles: async () => [
      { id: "btc", contract: "0xhandlebtc", owner, name: "btc", sources: [] },
    ],
  };
  const chain = {
    isVerified: async (): Promise<boolean | null> => onChain,
    setVerified: async (contract: string, ok: boolean): Promise<boolean> => {
      writes.push({ contract, ok });
      return true;
    },
  };
  const service = new PortfolioService(
    sync as never,
    {} as never,
    {} as never,
    svc("true"),
    chain as never,
  );
  return { service, writes };
}

describe("Cleanverse — CVI identity verification gates claiming", () => {
  it("fails closed when Cleanverse is unconfigured (no mock identity)", async () => {
    const verified = await svc("false").verify("0xabcdef");
    expect(verified.verified).toBe(false);
    expect(verified.did).toBeNull();

    // No address-magic mock — an `ff`-suffixed address is NOT auto-verified.
    const notFake = await svc("false").verify("0xabcDEff");
    expect(notFake.verified).toBe(false);
  });

  it("reports whether verification is required", () => {
    expect(svc("true").required).toBe(true);
    expect(svc("false").required).toBe(false);
  });
});

describe("Cleanverse handle verification — frontend → backend → onchain", () => {
  it("leaves a handle unverified on-chain when Cleanverse is unconfigured", async () => {
    const { service, writes } = portfolio("0xabcff", false);
    const result = await service.verifyHandle("btc");
    expect(result.verification.verified).toBe(false);
    // On-chain is already false and the check fails closed → no state change.
    expect(writes).toEqual([]);
    expect(result.verifiedOnChain).toBe(false);
  });

  it("clears a stale verified flag when Cleanverse fails closed", async () => {
    const { service, writes } = portfolio("0xabc00", true);
    const result = await service.verifyHandle("btc");
    expect(result.verification.verified).toBe(false);
    expect(writes).toEqual([{ contract: "0xhandlebtc", ok: false }]);
    expect(result.verifiedOnChain).toBe(false);
  });

  it("returns null on-chain state when the chain gateway is disabled", async () => {
    const { service, writes } = portfolio("0xabcff", null);
    const result = await service.verifyHandle("btc");
    expect(writes).toEqual([]);
    expect(result.verifiedOnChain).toBeNull();
  });

  it("rejects unknown handles", async () => {
    const { service } = portfolio("0xabcff", false);
    await expect(service.verifyHandle("nope")).rejects.toThrow(/No handle/);
  });

  it("reads the current on-chain flag for the UI badge", async () => {
    const { service } = portfolio("0xabcff", true);
    expect(await service.handleVerified("btc")).toEqual({ verified: true });
  });
});

describe("RpcService — Alchemy-first RPC resolution", () => {
  it("prefers an explicit Alchemy RPC URL", () => {
    const svc = new RpcService({
      get: (k: string) => (k === "ALCHEMY_RPC_URL" ? "https://monad-testnet.g.alchemy.com/v2/abc" : undefined),
    } as never);
    expect(svc.url).toBe("https://monad-testnet.g.alchemy.com/v2/abc");
  });

  it("builds an Alchemy URL from just the API key", () => {
    const svc = new RpcService({
      get: (k: string) => (k === "ALCHEMY_API_KEY" ? "key123" : undefined),
    } as never);
    expect(svc.url).toContain("monad-testnet.g.alchemy.com/v2/key123");
  });

  it("falls back to the public Monad RPC", () => {
    const svc = new RpcService({ get: () => undefined } as never);
    expect(svc.url).toContain("rpc.testnet.monad.xyz");
  });
});