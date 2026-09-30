import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";
import { expectError, expectErrorSig } from "./registry.test";

describe("Configurator (protocol-level fee curve)", () => {
  let cfg: Contract;
  let alice: any;
  let bob: any;

  beforeEach(async () => {
    [alice, bob] = await ethers.getSigners();
    cfg = await (await ethers.getContractFactory("Configurator")).deploy();
  });

  it("defaults: 0.25% floor, 2.5% cap, aura 999_999", async () => {
    expect(await cfg.depositFeeMinBps()).to.equal(25n);
    expect(await cfg.depositFeeMaxBps()).to.equal(250n);
    expect(await cfg.maxFeeAura()).to.equal(999_999n);
  });

  it("scales the fee with aura: 0 → 0, any aura → ≥ floor, max aura → cap", async () => {
    expect(await cfg.depositFeeBps(0n)).to.equal(0n);
    expect(await cfg.depositFeeBps(1n)).to.equal(25n); // floor
    expect(await cfg.depositFeeBps(50_000n)).to.equal(25n); // still floor-dominated
    expect(await cfg.depositFeeBps(800_000n)).to.equal(200n); // 800k/999999 × 250
    expect(await cfg.depositFeeBps(999_999n)).to.equal(250n); // cap
  });

  it("owner updates the curve; non-owners are rejected", async () => {
    await cfg.setDepositFeeRange(50, 500);
    expect(await cfg.depositFeeMinBps()).to.equal(50n);
    expect(await cfg.depositFeeMaxBps()).to.equal(500n);
    expect(await cfg.depositFeeBps(999_999n)).to.equal(500n);

    await cfg.setMaxFeeAura(1_000_000n);
    expect(await cfg.maxFeeAura()).to.equal(1_000_000n);

    // Clamp: aura ≥ maxFeeAura → exactly the max fee (no overshoot past cap).
    await cfg.setMaxFeeAura(100_000n);
    expect(await cfg.depositFeeBps(99_999n)).to.equal(499n); // below the cap
    expect(await cfg.depositFeeBps(100_000n)).to.equal(500n); // at the cap
    expect(await cfg.depositFeeBps(999_999n)).to.equal(500n); // clamped at cap

    await expectErrorSig(cfg.connect(bob).setDepositFeeRange(0, 500), "OwnableUnauthorizedAccount(address)");
    await expectError(cfg.setDepositFeeRange(500, 100), "BadSplit"); // min > max
    await expectError(cfg.setMarketFeeBps(20_000), "BadSplit"); // > BPS
  });
});

describe("AddressesProvider (protocol registry)", () => {
  let ap: Contract;
  let alice: any;
  let bob: any;

  beforeEach(async () => {
    [alice, bob] = await ethers.getSigners();
    ap = await (await ethers.getContractFactory("AddressesProvider")).deploy();
  });

  it("registers every protocol address", async () => {
    for (const [setter, getter] of [
      ["setUsdc", "usdc"],
      ["setAuraToken", "auraToken"],
      ["setOracleFactory", "oracleFactory"],
      ["setHandleFactory", "handleFactory"],
      ["setMarketMaker", "marketMaker"],
      ["setOrderBook", "orderBook"],
      ["setRevenueSharing", "revenueSharing"],
      ["setPool", "pool"],
      ["setConfigurator", "configurator"],
    ] as const) {
      expect(await ap[getter]()).to.equal(ethers.ZeroAddress);
      await ap[setter](bob.address);
      expect(await ap[getter]()).to.equal(bob.address);
    }
  });

  it("rejects zero addresses and non-owners", async () => {
    await expectError(ap.setUsdc(ethers.ZeroAddress), "ZeroAddress");
    await expectErrorSig(ap.connect(bob).setMarketMaker(alice.address), "OwnableUnauthorizedAccount(address)");
  });
});