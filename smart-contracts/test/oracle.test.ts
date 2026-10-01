import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  makeReceipt,
  signReceipt,
  h,
  RESOLUTION_TYPES,
  expectError,
  deployOracleFactory,
} from "./registry.test";

const ORACLE_PK =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ws = 1_777_000_000_000n;

describe("Oracle (per-window resolution authority)", () => {
  let usdc: Contract;
  let registry: Contract;
  let factory: Contract;
  let wo: Contract;
  let oracle: any;
  const ws2 = ws + 900_000n;

  beforeEach(async () => {
    oracle = new ethers.Wallet(ORACLE_PK, ethers.provider);
    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    registry = await (
      await ethers.getContractFactory("MarketRegistry")
    ).deploy(await usdc.getAddress());
    await registry.registerHandle(h("btc"), 15);
    factory = await deployOracleFactory(
      await registry.getAddress(),
      oracle.address,
    );
    // Direct oracle deployments in these tests act as the "market".
    const [deployer] = await ethers.getSigners();
    await factory.setMarket(deployer.address);
    const market = deployer.address;
    wo = await (
      await ethers.getContractFactory("Oracle")
    ).deploy(
      h("btc"),
      ws,
      oracle.address,
      await registry.getAddress(),
      market,
      "{}",
    );
  });

  it("each window is its own independent oracle", async () => {
    const [deployer] = await ethers.getSigners();
    const wo2 = await (
      await ethers.getContractFactory("Oracle")
    ).deploy(
      h("btc"),
      ws2,
      oracle.address,
      await registry.getAddress(),
      deployer.address,
      "{}",
    );
    expect(await wo.windowStatus()).to.equal(0n); // OPEN
    expect(await wo2.windowStatus()).to.equal(0n);
    // Freezing one window does not touch the other.
    await wo.connect(oracle).freezeWindow();
    expect(await wo.windowStatus()).to.equal(1n); // FROZEN
    expect(await wo2.windowStatus()).to.equal(0n); // still OPEN
  });

  it("settles a window from a valid EIP-712 receipt, exactly once", async () => {
    const receipt = makeReceipt(h("btc"), ws, true);
    const sig = await signReceipt(oracle, wo, receipt);

    // Ethers and the contract must agree on the EIP-712 digest.
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const domain = {
      name: "Aura Oracle",
      version: "1",
      chainId,
      verifyingContract: await wo.getAddress(),
    };
    const ethDigest = ethers.TypedDataEncoder.hash(
      domain,
      RESOLUTION_TYPES,
      receipt,
    );
    expect(ethDigest).to.equal(await wo.receiptDigest(receipt));

    await wo.connect(oracle).submitResolution(receipt, sig);
    expect(await wo.windowStatus()).to.equal(2n); // RESOLVED
    const [direction, indexClose, , resolvedAt] = await wo.resolutionOf();
    expect(direction).to.equal(true);
    expect(indexClose).to.equal(receipt.indexClose);
    expect(resolvedAt).to.equal(receipt.resolvedAt);

    await expectError(
      wo.connect(oracle).submitResolution(receipt, sig),
      "WindowNotOpenOrFrozen",
    );
  });

  it("carries + stores the evidence hash and emits it in WindowResolved", async () => {
    const receipt = makeReceipt(h("btc"), ws, true);
    const sig = await signReceipt(oracle, wo, receipt);
    await expect(wo.connect(oracle).submitResolution(receipt, sig))
      .to.emit(wo, "WindowResolved")
      .withArgs(
        receipt.handleId,
        receipt.windowStart,
        receipt.direction,
        receipt.indexClose,
        anyValue,
        receipt.inputsHash,
      );
    expect(await wo.resolutionInputsHash()).to.equal(receipt.inputsHash);
  });

  it("rejects a resolution whose inputsHash was tampered with (signature covers it)", async () => {
    const receipt = makeReceipt(h("btc"), ws, true);
    const sig = await signReceipt(oracle, wo, receipt);
    const tampered = { ...receipt, inputsHash: ethers.id("tampered") };
    await expectError(
      wo.connect(oracle).submitResolution(tampered, sig),
      "InvalidSignature",
    );
  });

  it("rejects a zero-strike receipt (degenerate 'rise above 0.00' window)", async () => {
    const receipt = {
      ...makeReceipt(h("btc"), ws, true),
      indexOpen: 0n,
      expectation: 0n,
    };
    const sig = await signReceipt(oracle, wo, receipt);
    await expectError(
      wo.connect(oracle).submitResolution(receipt, sig),
      "BadStrike",
    );
  });

  it("rejects a receipt for a different window", async () => {
    const receipt = makeReceipt(h("btc"), ws2, true); // wrong windowStart
    const sig = await signReceipt(oracle, wo, receipt);
    await expectError(
      wo.connect(oracle).submitResolution(receipt, sig),
      "BadWindow",
    );
  });

  it("rejects a signature from the wrong signer", async () => {
    const attacker = new ethers.Wallet(
      "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
      ethers.provider,
    );
    const receipt = makeReceipt(h("btc"), ws, true);
    const sig = await signReceipt(attacker, wo, receipt);
    await expectError(
      wo.connect(oracle).submitResolution(receipt, sig),
      "InvalidSignature",
    );
  });

  it("voids a window and never resolves it after", async () => {
    await wo.connect(oracle).voidWindow("oracle timeout");
    expect(await wo.windowStatus()).to.equal(3n); // VOIDED
    const receipt = makeReceipt(h("btc"), ws, true);
    const sig = await signReceipt(oracle, wo, receipt);
    await expectError(
      wo.connect(oracle).submitResolution(receipt, sig),
      "WindowNotOpenOrFrozen",
    );
  });

  it("oracle factory deploys and tracks per-window oracles", async () => {
    const addr = await factory.deployOracle.staticCall(h("btc"), ws, "{}");
    await factory.deployOracle(h("btc"), ws, "{}");
    expect(await factory.oracleOf(h("btc"), ws)).to.equal(addr);
    // Idempotent.
    const again = await factory.deployOracle.staticCall(h("btc"), ws, "{}");
    expect(again).to.equal(addr);
  });
});
