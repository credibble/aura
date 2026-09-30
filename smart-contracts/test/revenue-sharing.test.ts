import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";
import { h, expectError } from "./registry.test";

const ONE = 10n ** 18n;

describe("RevenueSharing (pure splitter) + Handle (claims) + singleton Pool (PLP)", () => {
  let usdc: Contract;
  let aura: Contract;
  let revenue: Contract;
  let factory: Contract;
  let poolC: Contract;
  let ap: Contract;
  let handleC: Contract;
  let alice: any;
  let bob: any;
  let treasury: any;
  const handle = h("elon");

  const stake = async (): Promise<Contract> =>
    ethers.getContractAt("Stake", await factory.stakeOf(handle));

  beforeEach(async () => {
    [alice, bob, treasury] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    aura = await (await ethers.getContractFactory("AuraToken")).deploy();
    const configurator = await (
      await ethers.getContractFactory("Configurator")
    ).deploy();
    ap = await (await ethers.getContractFactory("AddressesProvider")).deploy();
    factory = await (
      await ethers.getContractFactory("HandleFactory")
    ).deploy(
      await aura.getAddress(),
      await usdc.getAddress(),
      await configurator.getAddress(),
      await ap.getAddress(),
    );
    revenue = await (
      await ethers.getContractFactory("RevenueSharing")
    ).deploy(await usdc.getAddress(), await factory.getAddress());
    await ap.setRevenueSharing(await revenue.getAddress());
    await revenue.setProtocol(treasury.address);
    const fc = await (await ethers.getContractFactory("FeeCollector")).deploy();
    await revenue.setFeeCollector(await fc.getAddress());
    // The singleton auraLP vault (a separate top-level contract, shared by every
    // handle) — not wired onto the factory until a test chooses to.
    poolC = await (
      await ethers.getContractFactory("Pool")
    ).deploy(
      "Aura Pool",
      "AURALP",
      await usdc.getAddress(),
      await ap.getAddress(),
    );
    // A handle: creator = alice (owner), wired to the factory + revenue.
    await factory.createHandle(handle, alice.address, "Elon", "ELON", "", 15n, [0n]);
    handleC = await ethers.getContractAt(
      "Handle",
      await factory.handleOf(handle),
    );

    await aura.mint(alice.address, 1_000_000n * ONE);
    await usdc.mint(alice.address, 1_000_000n * ONE);
    await usdc.mint(bob.address, 1_000_000n * ONE);
    await usdc.mint(treasury.address, 1_000_000n * ONE);
    await usdc
      .connect(alice)
      .approve(await revenue.getAddress(), 1_000_000n * ONE);
    await usdc
      .connect(bob)
      .approve(await revenue.getAddress(), 1_000_000n * ONE);
    // Shares: 30% creator, 20% LPs, 50% protocol.
    await revenue.setCustomShares(handle, 3000, 2000, 5000);
  });

  it("splits a fee deposit (creator claims the Handle; protocol goes to the FeeCollector; LP folds until the Pool is wired)", async () => {
    await revenue.setMarket(alice.address, true);
    await revenue.connect(alice).depositFees(handle, 1000n * ONE);

    // 30% to the creator → routed to the HANDLE, claimed by the creator.
    const fc = await ethers.getContractAt(
      "FeeCollector",
      await revenue.feeCollector(),
    );
    expect(await usdc.balanceOf(await handleC.getAddress())).to.equal(
      300n * ONE,
    );
    const before = await usdc.balanceOf(alice.address);
    await handleC.connect(alice).claim();
    expect((await usdc.balanceOf(alice.address)) - before).to.equal(300n * ONE);

    // No Pool wired → lp(20) + protocol(50) = 70% to the FeeCollector.
    expect(await fc.balanceOf(await usdc.getAddress())).to.equal(700n * ONE);
    const protoBefore = await usdc.balanceOf(alice.address);
    // FeeCollector.withdraw pays msg.sender (owner = deployer/alice here).
    await fc.connect(alice).withdraw(await usdc.getAddress(), 700n * ONE);
    expect((await usdc.balanceOf(alice.address)) - protoBefore).to.equal(
      700n * ONE,
    );

    // Wire the singleton Pool → the LP cut lands in it (20% of the next fee).
    await ap.setPool(await poolC.getAddress());
    await revenue.connect(alice).depositFees(handle, 1000n * ONE);
    expect(await usdc.balanceOf(await poolC.getAddress())).to.equal(200n * ONE);
    expect(await fc.balanceOf(await usdc.getAddress())).to.equal(500n * ONE);

    // Only the creator may claim the handle's USDC.
    await expectError(handleC.connect(bob).claim(), "NotCreator");
  });

  it("every handle must have a creator", async () => {
    await expectError(
      factory.createHandle(
        h("nope"),
        ethers.ZeroAddress,
        "Nope",
        "NOPE",
        "",
        15n,
        [0n],
      ),
      "ZeroAddress",
    );
  });

  it("bankFees splits fees already held (no transfer)", async () => {
    await ap.setPool(await poolC.getAddress());
    await revenue.setMarket(alice.address, true);
    await usdc.connect(alice).transfer(await revenue.getAddress(), 1000n * ONE);
    await revenue.connect(alice).bankFees(handle); // sweeps the 1000 held
    const fc = await ethers.getContractAt(
      "FeeCollector",
      await revenue.feeCollector(),
    );
    expect(await usdc.balanceOf(await handleC.getAddress())).to.equal(
      300n * ONE,
    );
    expect(await fc.balanceOf(await usdc.getAddress())).to.equal(500n * ONE);
    expect(await usdc.balanceOf(await poolC.getAddress())).to.equal(200n * ONE);
  });

  it("Stake receipts: single-factor vault + aura-scaled deposit fee + symmetric inflation defense", async () => {
    const stakeC = await stake();
    await aura.connect(alice).approve(await stakeC.getAddress(), 1_000n * ONE);
    await stakeC.connect(alice).deposit(100n * ONE);
    // No aura (default) → 0 deposit fee → 100 net × VIRTUAL_SHARES = 100,000 shares.
    expect(await stakeC.balanceOf(alice.address)).to.equal(100_000n * ONE);
    // valuePerToken includes the offsets: (assets+1)/(supply+1e3).
    expect(await stakeC.valuePerToken()).to.be.closeTo(
      (100n * ONE * ONE) / (100_000n * ONE),
      1n,
    ); // offsets negligible at this scale

    // Bob gifts 100 → the vault numerator grows WITHOUT minting shares.
    await aura.mint(bob.address, 100n * ONE);
    await aura.connect(bob).approve(await stakeC.getAddress(), 100n * ONE);
    await stakeC.connect(bob).reward(100n * ONE, "CRE reward for stakers");
    expect(await stakeC.valuePerToken()).to.be.closeTo(
      (200n * ONE * ONE) / (100_000n * ONE),
      1n,
    );

    // Alice withdraws 50,000 shares at the risen share price (symmetrical math).
    const before = await aura.balanceOf(alice.address);
    await stakeC.connect(alice).withdraw(50_000n * ONE);
    const got = (await aura.balanceOf(alice.address)) - before;
    expect(got).to.be.closeTo((50_000n * 200n * ONE) / 100_000n, ONE);
  });

  it("LP providers earn the LP cut on the Pool receipt (principal + yield)", async () => {
    await ap.setPool(await poolC.getAddress());
    await usdc.connect(bob).approve(await poolC.getAddress(), 1_000n * ONE);
    await poolC.connect(bob).deposit(1_000n * ONE);
    // Virtual-offset shares: 1000 × VIRTUAL_SHARES on the first deposit.
    expect(await poolC.balanceOf(bob.address)).to.equal(1_000_000n * ONE);

    await revenue.setMarket(alice.address, true);
    await usdc.connect(alice).approve(await revenue.getAddress(), 100n * ONE);
    await revenue.connect(alice).depositFees(handle, 100n * ONE); // 20% → LPs = 20

    const before = await usdc.balanceOf(bob.address);
    await poolC.connect(bob).withdraw(await poolC.balanceOf(bob.address));
    const got = (await usdc.balanceOf(bob.address)) - before;
    // Virtual-offset payout mirrors deposit mint exactly — ±wei of rounding dust.
    expect(got).to.be.closeTo(1020n * ONE, 10); // principal + 20 yield
  });

  it("rejects bad shares and unwhitelisted fee deposits", async () => {
    await expectError(
      revenue.setCustomShares(handle, 3000, 3000, 3000),
      "BadSplit",
    ); // 9000
    await expectError(
      revenue.connect(alice).depositFees(handle, 100n * ONE),
      "NotMarket",
    );
    // Whitelisted sender but no handle → UnregisteredHandle.
    await revenue.setMarket(alice.address, true);
    await expectError(
      revenue.connect(alice).depositFees(h("nope"), 100n * ONE),
      "UnregisteredHandle",
    );
  });

  it("stakers profit as the handle's aura rises while fees accrue", async () => {
    // Protocol pushes a low aura; alice stakes early (deposit fee boosts the vault).
    await factory.setAuraUpdater(handle, treasury.address);
    await handleC.connect(treasury).updateAura(2000n, "test aura"); // 20.00
    const stakeC = await stake();
    await aura.connect(alice).approve(await stakeC.getAddress(), 1_000n * ONE);
    await stakeC.connect(alice).deposit(100n * ONE);
    const v0 = await stakeC.valuePerToken();

    // Aura rises AND the protocol gifts AURA (CRE stake-gifting) → the vault
    // numerator grows, so the single-factor share price rises for stakers.
    await handleC.connect(treasury).updateAura(8000n, "test aura"); // 80.00
    await aura.mint(bob.address, 100n * ONE);
    await aura.connect(bob).approve(await stakeC.getAddress(), 100n * ONE);
    await stakeC.connect(bob).reward(100n * ONE, "CRE reward for stakers");

    const v1 = await stakeC.valuePerToken();
    expect(v1).to.be.greaterThan(v0); // accrued fees pushed the share price up

    const before = await aura.balanceOf(alice.address);
    await stakeC.connect(alice).withdraw(await stakeC.balanceOf(alice.address));
    const got = (await aura.balanceOf(alice.address)) - before;
    // Staked 100 (fee 0.25% at aura 20); fees accrued → withdrew more than deposited.
    expect(got).to.be.greaterThan(100n * ONE);
  });

  it("Configurator: deposit fee scales with the handle aura (0 → 0.25% floor → 2.5% cap)", async () => {
    const cfg = await (
      await ethers.getContractFactory("Configurator")
    ).deploy();
    expect(await cfg.depositFeeMinBps()).to.equal(25n); // 0.25%
    expect(await cfg.depositFeeMaxBps()).to.equal(250n); // 2.5%
    expect(await cfg.maxFeeAura()).to.equal(999_999n);

    expect(await cfg.depositFeeBps(0n)).to.equal(0n); // no aura → no fee
    expect(await cfg.depositFeeBps(999_999n)).to.equal(250n); // max aura → 2.5%
    expect(await cfg.depositFeeBps(1n)).to.equal(25n); // any aura → 0.25% floor
  });

  it("HandleFactory deploys one Handle + Stake per handle (idempotent); claims are on the Handle", async () => {
    expect(await factory.handleOf(handle)).to.equal(await handleC.getAddress());
    expect(await handleC.owner()).to.equal(alice.address);
    expect(await handleC.stake()).to.equal(await factory.stakeOf(handle));
    await ap.setPool(await poolC.getAddress());
    expect(await factory.poolOf(handle)).to.equal(await poolC.getAddress());
    expect(await factory.poolOf(handle)).to.equal(await poolC.getAddress());
    await expectError(
      factory.createHandle(handle, alice.address, "Elon", "ELON", "", 15n, [0n]),
      "HandleExists",
    );
  });
});
