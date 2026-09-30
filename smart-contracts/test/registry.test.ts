import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";

export const SCALED = (n: number): bigint => BigInt(Math.round(n * 10_000));

/** Uniform 1e18-scaled probabilities that sum EXACTLY to 1e18 (last absorbs). */
export function uniformProbs(n: number): bigint[] {
  const share = 10n ** 18n / BigInt(n);
  const probs = Array.from({ length: n }, () => share);
  probs[n - 1] = 10n ** 18n - share * BigInt(n - 1);
  return probs;
}

/** Encode a handle as its on-chain bytes32 (left-aligned, zero-padded). */
export const h = (s: string): string => ethers.encodeBytes32String(s);

/** Deploy the per-window oracle factory (one Oracle per (handle, window)).
 *  `market` is the trusted MarketMaker; pass it when it is already deployed,
 *  otherwise call `factory.setMarket(...)` right after deploying the market. */
export async function deployOracleFactory(
  registryAddr: string,
  signer: string,
  market?: string,
): Promise<Contract> {
  const factory = await (
    await ethers.getContractFactory("OracleFactory")
  ).deploy(registryAddr, signer);
  if (market) await factory.setMarket(market);
  return factory;
}

/** The Oracle contract for (handleId, windowStart). */
export async function resolveOracle(
  factory: Contract,
  handleId: string,
  ws: bigint,
): Promise<Contract> {
  return await ethers.getContractAt(
    "Oracle",
    await factory.oracleOf(handleId, ws),
  );
}

/**
 * Move chain time past the window's end and submit a signed resolution to its
 * Oracle — the on-chain precondition `MarketMaker.settle` now enforces.
 */
export async function resolveWindow(opts: {
  wo: Contract;
  signer: any;
  handleId: string;
  windowStart: bigint;
  windowEnd: bigint;
  direction?: boolean;
}): Promise<void> {
  // Only advance time when the window hasn't ended yet — tests often move the
  // clock themselves, and a backwards/same-timestamp jump is rejected by the EVM.
  const latest = await ethers.provider.getBlock("latest");
  const now = Number(latest?.timestamp ?? 0);
  const end = Number(opts.windowEnd);
  if (now < end) {
    await ethers.provider.send("evm_increaseTime", [end - now + 2]);
    await ethers.provider.send("evm_mine", []);
  }
  const receipt = makeReceipt(
    opts.handleId,
    opts.windowStart,
    opts.direction ?? true,
    opts.windowEnd,
  );
  const sig = await signReceipt(opts.signer, opts.wo, receipt);
  await opts.wo.connect(opts.signer).submitResolution(receipt, sig);
}

/**
 * Create + GRADUATE a handle (aura 100.00 + graduated=true) so the MarketMaker
 * will open windows for it.
 */
export async function graduateHandle(
  handleFactory: Contract,
  handleId: string,
  owner: any,
  oracle: any,
): Promise<Contract> {
  await handleFactory.createHandle(
    handleId,
    owner.address,
    "Test",
    "TST",
    "",
    15n,
    [3n],
  );
  const handleC = await ethers.getContractAt(
    "Handle",
    await handleFactory.handleOf(handleId),
  );
  await handleFactory.setAuraUpdater(handleId, oracle.address);
  await handleC.connect(oracle).updateAura(10_000n, "graduated"); // 100.00 aura
  await handleC.connect(oracle).setGraduated(true); // backend (auraUpdater) grants graduation
  return handleC;
}

/**
 * Assert a transaction reverts with a custom error. Library-defined errors are
 * not in the contract ABI (ethers can't decode them), so match on the 4-byte
 * selector: keccak256("ErrorName()")[0:4] vs the revert data.
 */
export async function expectError(
  tx: Promise<unknown>,
  name: string,
): Promise<void> {
  let err: unknown;
  try {
    await tx;
  } catch (e) {
    err = e;
  }
  expect(err, `expected revert with ${name}`).to.exist;
  const e = err as { data?: unknown; info?: { error?: { data?: unknown } } };
  const data = toHex(e.data ?? e.info?.error?.data);
  const selector = ethers.id(`${name}()`).slice(0, 10).toLowerCase();
  expect(
    data.toLowerCase().startsWith(selector),
    `revert selector for ${name}`,
  ).to.equal(true);
}

/** Assert a revert by a full custom-error SIGNATURE (e.g. `OwnableUnauthorizedAccount(address)`). */
export async function expectErrorSig(
  tx: Promise<unknown>,
  signature: string,
): Promise<void> {
  let err: unknown;
  try {
    await tx;
  } catch (e) {
    err = e;
  }
  expect(err, `expected revert with ${signature}`).to.exist;
  const e = err as { data?: unknown; info?: { error?: { data?: unknown } } };
  const data = toHex(e.data ?? e.info?.error?.data);
  const selector = ethers.id(signature).slice(0, 10).toLowerCase();
  expect(
    data.toLowerCase().startsWith(selector),
    `revert selector for ${signature}`,
  ).to.equal(true);
}

function toHex(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return ethers.hexlify(data);
  if (data && typeof data === "object" && "data" in data)
    return toHex((data as { data: unknown }).data);
  return "";
}

export interface ReceiptValue {
  handleId: string;
  windowStart: bigint;
  windowEnd: bigint;
  s: bigint;
  expectation: bigint;
  delta: bigint;
  indexOpen: bigint;
  indexClose: bigint;
  direction: boolean;
  itemCount: number;
  outcomesHash: string;
  resolvedAt: bigint;
}

export const RESOLUTION_TYPES = {
  ResolutionReceipt: [
    { name: "handleId", type: "bytes32" },
    { name: "windowStart", type: "uint256" },
    { name: "windowEnd", type: "uint256" },
    { name: "s", type: "uint256" },
    { name: "expectation", type: "uint256" },
    { name: "delta", type: "int256" },
    { name: "indexOpen", type: "uint256" },
    { name: "indexClose", type: "uint256" },
    { name: "direction", type: "bool" },
    { name: "itemCount", type: "uint32" },
    { name: "outcomesHash", type: "bytes32" },
    { name: "resolvedAt", type: "uint256" },
  ],
};

export function makeReceipt(
  handleId: string,
  ws: bigint,
  direction: boolean,
  windowEnd?: bigint,
): ReceiptValue {
  return {
    handleId, // already encoded as bytes32 via h()
    windowStart: ws,
    windowEnd: windowEnd ?? ws + 900_000n,
    s: SCALED(72.5),
    expectation: SCALED(68.25),
    delta: SCALED(direction ? 4.25 : -4.25),
    indexOpen: SCALED(64.1),
    indexClose: SCALED(direction ? 68.35 : 60.1),
    direction,
    itemCount: 142,
    outcomesHash: ethers.ZeroHash,
    resolvedAt: ws + 900_050n,
  };
}

export async function signReceipt(
  signer: any,
  adapter: Contract,
  receipt: ReceiptValue,
): Promise<string> {
  return signer.signTypedData(
    {
      name: "Aura Oracle",
      version: "1",
      chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
      verifyingContract: await adapter.getAddress(),
    },
    RESOLUTION_TYPES,
    receipt,
  );
}

describe("MarketRegistry", () => {
  it("registers binary handles", async () => {
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const registry = await (
      await ethers.getContractFactory("MarketRegistry")
    ).deploy(await usdc.getAddress());
    await registry.registerHandle(h("btc"), 15);
    await registry.registerHandle(h("ai"), 240);
    expect(await registry.isRegistered(h("btc"))).to.equal(true);
    expect(await registry.isRegistered(h("ai"))).to.equal(true);
    expect(await registry.handleCount()).to.equal(2n);
    await expectError(
      registry.registerHandle(h("btc"), 15),
      "AlreadyRegistered",
    );
  });
});
