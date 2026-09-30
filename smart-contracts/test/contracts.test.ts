import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";
import { h, expectError, deployOracleFactory, uniformProbs } from "./registry.test";

const ORACLE_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ONE = 10n ** 18n;
const INDEX = 100n;

async function base() {
  const [alice, bob, treasury] = await ethers.getSigners();
  const oracle = new ethers.Wallet(ORACLE_PK, ethers.provider);
  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const aura = await (await ethers.getContractFactory("AuraToken")).deploy();
  const configurator = await (await ethers.getContractFactory("Configurator")).deploy();
  const ap = await (await ethers.getContractFactory("AddressesProvider")).deploy();
  const registry = await (await ethers.getContractFactory("MarketRegistry")).deploy(await usdc.getAddress());
  const factory = await deployOracleFactory(await registry.getAddress(), oracle.address);
  await registry.registerHandle(h("btc"), 15);
  const handleFactory = await (await ethers.getContractFactory("HandleFactory")).deploy(await aura.getAddress(), await usdc.getAddress(), await configurator.getAddress(), await ap.getAddress());
  await handleFactory.createHandle(h("btc"), alice.address, "Bitcoin", "BTC", "", 15n, [100_001_001n, 3_000_001n]);
  const handleC = await ethers.getContractAt("Handle", await handleFactory.handleOf(h("btc")));
  const stakeC = await ethers.getContractAt("Stake", await handleFactory.stakeOf(h("btc")));
  const poolC = await (await ethers.getContractFactory("Pool")).deploy("Aura Pool", "AURALP", await usdc.getAddress(), await ap.getAddress());
  const revenue = await (await ethers.getContractFactory("RevenueSharing")).deploy(await usdc.getAddress(), await handleFactory.getAddress());
  await ap.setRevenueSharing(await revenue.getAddress());
  const market = await (await ethers.getContractFactory("MarketMaker")).deploy(
    await factory.getAddress(), await usdc.getAddress(), await revenue.getAddress(), await handleFactory.getAddress(), await configurator.getAddress(), 0n,
  );
  await revenue.setMarket(await market.getAddress(), true);
  await factory.setMarket(await market.getAddress());
  await ap.setMarketMaker(await market.getAddress());
  await ap.setOracleFactory(await factory.getAddress());
  await ap.setPool(await poolC.getAddress());
  const feeCollector = await (await ethers.getContractFactory("FeeCollector")).deploy();
  await revenue.setFeeCollector(await feeCollector.getAddress());
  // Graduate the handle (backend: auraUpdater = oracle, routed via factory).
  await handleFactory.setAuraUpdater(h("btc"), oracle.address);
  await handleC.connect(oracle).updateAura(10_000n, "graduated");
  await handleC.connect(oracle).setGraduated(true);
  for (const who of [alice, bob]) {
    await usdc.mint(who.address, 1_000_000n * ONE);
    await usdc.connect(who).approve(await market.getAddress(), 1_000_000n * ONE);
  }
  await usdc.connect(bob).approve(await poolC.getAddress(), 1_000_000n * ONE);
  await poolC.connect(bob).deposit(1_000_000n * ONE);
  return { alice, bob, treasury, oracle, usdc, aura, registry, factory, ap, handleFactory, handleC, stakeC, poolC, revenue, market, feeCollector };
}

describe("Full contract scenarios", () => {
  it("Pool: decimals match USDC, idle/earned math, withdraw capped by idle, provider-gated markets", async () => {
    const { alice, usdc, poolC, bob, market, ap } = await base();
    expect(await poolC.decimals()).to.equal(18n); // mirrors the underlying USDC
    expect(await poolC.idle()).to.equal(1_000_000n * ONE);
    expect(await poolC.earned(bob.address)).to.be.closeTo(1_000_000n * ONE, ONE);

    await ap.setMarketMaker(alice.address); // alice acts as a whitelisted market
    await poolC.connect(alice).reserve(await market.getAddress(), 400_000n * ONE); // oracle key
    expect(await poolC.idle()).to.equal(600_000n * ONE);
    // 700,000 shares Ã— 1,000,000/1e9 â‰ˆ 700 USDC... withdraw enough to exceed idle.
    await expectError(poolC.connect(bob).withdraw(700_000_000n * ONE), "ReservedByMarkets");
    // Only the AddressesProvider's registered markets may back windows.
    await ap.setMarketMaker(bob.address); // alice is no longer a whitelisted market
    await expectError(poolC.connect(alice).reserve(await market.getAddress(), 1n), "NotMarket");
    // Only the owner can whitelist.

  });

  it("Handle: curation (curator-gated), SourcesChanged emits the full list, aura updater guards", async () => {
    const { alice, bob, treasury, handleC, handleFactory } = await base();
    // Metadata is protocol-only now — neither a stranger nor the OWNER curates.
    // (bob is the oracle key in this suite, so use treasury as the stranger.)
    await expectError(handleC.connect(treasury).setMetadata("x"), "NotCurator");
    await expectError(handleC.connect(alice).setMetadata("y"), "NotCurator");

    // The factory (protocol) bootstraps the updater; the updater curates.
    await handleFactory.setAuraUpdater(h("btc"), treasury.address);
    await handleC.connect(treasury).setMetadata("{\"theme\":\"dark\"}");
    await handleC.connect(treasury).setWindowMinutes(30n);
    await expectError(handleC.connect(alice).setWindowMinutes(60n), "NotCurator");
    expect(await handleC.metadata()).to.equal("{\"theme\":\"dark\"}");
    expect(await handleC.windowMinutes()).to.equal(30n);

    await handleC.connect(treasury).addSource('{"platform":"github","username":"bitcoin"}');
    await handleC.connect(treasury).addSource('{"platform":"bbc","outlet":"bbc"}');
    await expectError(handleC.connect(alice).addSource("x"), "NotCurator");
    expect(await handleC.sourcesCount()).to.equal(2n);
    expect(await handleC.sources(0n)).to.equal('{"platform":"github","username":"bitcoin"}');

    await handleC.connect(treasury).removeSource(0n);
    expect(await handleC.sourcesCount()).to.equal(1n);
    expect(await handleC.sources(0n)).to.equal('{"platform":"bbc","outlet":"bbc"}');
    await expectError(handleC.connect(treasury).removeSource(5n), "BadIndex");

    await expectError(handleC.connect(bob).updateAura(5000n, "nope"), "NotUpdater");
    await handleC.connect(treasury).updateAura(5000n, "test");
    expect(await handleC.aura()).to.equal(5000n);

    // Graduation requires â‰¥ 100 aura and is backend-only.
    await expectError(handleC.connect(alice).setGraduated(false), "NotCurator");
    await handleC.connect(treasury).setGraduated(false); // un-graduate allowed
    await handleC.connect(treasury).updateAura(10_000n, "graduated"); // 100.00
    await handleC.connect(treasury).setGraduated(true);
    expect(await handleC.graduated()).to.equal(true);
  });

  it("Handle: stores multiple categories and hasCategory finds them; >MAX_CATEGORIES reverts", async () => {
    const { alice, oracle, handleC, handleFactory } = await base();
    // Built with [sport/football/binary, people/binary] (see base()).
    expect(await handleC.categoriesCount()).to.equal(2n);
    expect(await handleC.categories(0n)).to.equal(100_001_001n);
    expect(await handleC.categories(1n)).to.equal(3_000_001n);
    expect(await handleC.hasCategory(100_001_001n)).to.equal(true);
    expect(await handleC.hasCategory(3_000_001n)).to.equal(true);
    expect(await handleC.hasCategory(7_000_001n)).to.equal(false);

    // The curator can replace the whole set.
    await handleC.connect(oracle).setCategories([7_000_001n]);
    expect(await handleC.categoriesCount()).to.equal(1n);
    expect(await handleC.hasCategory(100_001_001n)).to.equal(false);
    expect(await handleC.hasCategory(7_000_001n)).to.equal(true);

    // Empty and oversized sets are rejected (MAX_CATEGORIES = 4).
    await expectError(handleC.connect(oracle).setCategories([]), "ZeroAmount");
    await expectError(
      handleC.connect(oracle).setCategories([1n, 2n, 3n, 4n, 5n]),
      "TooManyCategories",
    );
    await expectError(
      handleFactory.createHandle(
        h("toomany"),
        alice.address,
        "Too",
        "TOO",
        "",
        15n,
        [1n, 2n, 3n, 4n, 5n],
      ),
      "TooManyCategories",
    );
  });

  it("RevenueSharing: global default shares (40/40/20) apply when no custom override; protocol zero guard", async () => {
    const { usdc, alice, revenue, handleC, poolC, ap, feeCollector } = await base();
    await revenue.setMarket(alice.address, true);
    await usdc.connect(alice).approve(await revenue.getAddress(), 1_000_000n * ONE);
    await ap.setPool(await poolC.getAddress());

    await revenue.connect(alice).depositFees(h("btc"), 1000n * ONE);
    // Defaults 40/40/20: user 400 (Handle), lp 400 (pool wired), protocol 200 (feeCollector).
    expect(await usdc.balanceOf(await handleC.getAddress())).to.equal(400n * ONE);
    expect(await usdc.balanceOf(await poolC.getAddress())).to.equal(1_000_400n * ONE);
    expect(await feeCollector.balanceOf(await usdc.getAddress())).to.equal(200n * ONE);

    await expectError(revenue.setProtocol(ethers.ZeroAddress), "ZeroAddress");
    // Custom override wins over the default.
    await revenue.setCustomShares(h("btc"), 3000, 2000, 5000);
    await revenue.connect(alice).depositFees(h("btc"), 1000n * ONE);
    expect(await usdc.balanceOf(await handleC.getAddress())).to.equal(400n * ONE + 300n * ONE);
    expect(await feeCollector.balanceOf(await usdc.getAddress())).to.equal(200n * ONE + 500n * ONE);
  });

  it("MarketMaker: settle length, share transfers with allowance", async () => {
    const { alice, bob, oracle, market, factory } = await base();
    const start = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    await market.connect(oracle).openWindow(h("btc"), start, start + 600n, ["YES", "NO"], ['{"handle":"btc","outcome":0}', '{"handle":"btc","outcome":1}'], uniformProbs(2), '{"handle":"btc","strike":50,"outcomes":["YES","NO"]}', 100_000n * ONE);
    const woO = await ethers.getContractAt("Oracle", await factory.oracleOf(h("btc"), start));
    const woAddr = await woO.getAddress();

    
    await market.connect(alice).buy(woO, 0n, 100n * ONE, 0n);
    const q = await market.shares(alice.address, woAddr, 0n);

    // Allowance-gated share transfer.
    await expectError(market.connect(alice).transferFrom(alice.address, bob.address, woO, 0n, q), "NotApproved");
    await market.connect(alice).approve(woO, 0n, q / 2n);
    await market.connect(alice).transferFrom(alice.address, bob.address, woO, 0n, q / 2n);
    expect(await market.shares(bob.address, woAddr, 0n)).to.equal(q / 2n);
    // Direct transfer (no allowance) works for the sender.
    await market.connect(bob).transfer(alice.address, woO, 0n, q / 4n);
    expect(await market.shares(bob.address, woAddr, 0n)).to.equal(q / 4n);

    // View pricing functions are consistent and bounded.
    const price = await market.priceOf(woO, 0n);
    const cost = await market.buyCost(woO, 0n, 100n * ONE);
    expect(price).to.be.greaterThan(0n);
    expect(price).to.be.lessThan(ONE);
    expect(cost).to.be.greaterThan(0n);

    await expectError(market.connect(alice).buy(woO, 9n, 10n * ONE, 0n), "BadOutcome");
    await expectError(market.connect(alice).sell(woO, 1n, 5n * ONE, 0n), "InsufficientShares");

    await ethers.provider.send("evm_increaseTime", [600]);
    await ethers.provider.send("evm_mine", []);
    await expectError(market.connect(oracle).settle(woO, 9n), "BadOutcome"); // out-of-range outcome
  });

  it("Stake: earned matches value, withdraw(0)/deposit(0) guards, receipts are transferable", async () => {
    const { alice, bob, aura, stakeC } = await base();
    await aura.mint(alice.address, 1_000n * ONE);
    await aura.connect(alice).approve(await stakeC.getAddress(), 1_000n * ONE);
    await stakeC.connect(alice).deposit(100n * ONE);
    const shares = await stakeC.balanceOf(alice.address);
    expect(await stakeC.totalAssets()).to.equal(100n * ONE);
    expect(await stakeC.earned(alice.address)).to.be.closeTo(100n * ONE, ONE);

    await stakeC.connect(alice).transfer(bob.address, shares / 2n);
    expect(await stakeC.balanceOf(bob.address)).to.equal(shares / 2n);
    expect(await stakeC.earned(bob.address)).to.be.closeTo(50n * ONE, ONE);

    await expectError(stakeC.connect(alice).deposit(0n), "ZeroAmount");
    await expectError(stakeC.connect(alice).withdraw(0n), "ZeroAmount");
  });

  it("AuraToken: mint, transfer and supply accounting", async () => {
    const { alice, bob, aura } = await base();
    await aura.mint(alice.address, 500n * ONE);
    await aura.connect(alice).transfer(bob.address, 200n * ONE);
    expect(await aura.balanceOf(alice.address)).to.equal(300n * ONE);
    expect(await aura.balanceOf(bob.address)).to.equal(200n * ONE);
    expect(await aura.totalSupply()).to.equal(500n * ONE);
  });

  it("Handle: curation can be split away from the aura updater", async () => {
    const { alice, oracle, handleFactory, handleC, treasury } = await base();
    // Today the updater doubles as curator (the pre-split behaviour).
    await handleFactory.setAuraUpdater(h("btc"), oracle.address);
    await handleC.connect(oracle).setMetadata('{"theme":"dark"}');

    // Give curation to a dedicated key…
    const curator = alice; // any distinct signer
    await handleFactory.setCurator(h("btc"), curator.address);
    expect(await handleC.curator()).to.equal(curator.address);

    // …after which the updater may push aura but no longer curate.
    await handleC.connect(curator).setMetadata('{"theme":"light"}');
    expect(await handleC.metadata()).to.equal('{"theme":"light"}');
    await expectError(
      handleC.connect(oracle).setMetadata('{"theme":"nope"}'),
      "NotCurator",
    );
    await expectError(handleC.connect(oracle).addSource("x"), "NotCurator");
    // Aura updates are unaffected — the roles are independent.
    await handleC.connect(oracle).updateAura(100n, "still the updater");

    // Handing curation back to the updater (zero address) restores the fallback.
    await handleFactory.setCurator(h("btc"), "0x0000000000000000000000000000000000000000");
    await handleC.connect(oracle).setMetadata('{"theme":"back"}');
    expect(await handleC.metadata()).to.equal('{"theme":"back"}');
    void treasury;
  });
});
