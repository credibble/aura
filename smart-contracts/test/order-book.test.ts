import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";
import {
  h,
  expectError,
  deployOracleFactory,
  graduateHandle,
  uniformProbs,
} from "./registry.test";

const ORACLE_PK =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ONE = 10n ** 18n;
const INDEX = 100n;

describe("OrderBook (limit orders on MarketMaker outcome shares)", () => {
  let usdc: Contract;
  let registry: Contract;
  let factory: Contract;
  let market: Contract;
  let book: Contract;
  let oracle: any;
  let alice: any;
  let bob: any;
  let wo: Contract;
  let woAddr: string;

  const startOf = async (): Promise<bigint> =>
    BigInt((await ethers.provider.getBlock("latest"))!.timestamp);

  beforeEach(async () => {
    [alice, bob] = await ethers.getSigners();
    oracle = new ethers.Wallet(ORACLE_PK, ethers.provider);
    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    registry = await (
      await ethers.getContractFactory("MarketRegistry")
    ).deploy(await usdc.getAddress());
    factory = await deployOracleFactory(
      await registry.getAddress(),
      oracle.address,
    );
    await registry.registerHandle(h("btc"), 15, false);
    const aura = await (await ethers.getContractFactory("AuraToken")).deploy();
    const configurator = await (
      await ethers.getContractFactory("Configurator")
    ).deploy();
    const ap = await (
      await ethers.getContractFactory("AddressesProvider")
    ).deploy();
    const handleFactory = await (
      await ethers.getContractFactory("HandleFactory")
    ).deploy(
      await aura.getAddress(),
      await usdc.getAddress(),
      await configurator.getAddress(),
      await ap.getAddress(),
    );
    const revenue = await (
      await ethers.getContractFactory("RevenueSharing")
    ).deploy(await usdc.getAddress(), await handleFactory.getAddress());
    await ap.setRevenueSharing(await revenue.getAddress());
    market = await (
      await ethers.getContractFactory("MarketMaker")
    ).deploy(
      await factory.getAddress(),
      await usdc.getAddress(),
      await revenue.getAddress(),
      await handleFactory.getAddress(),
      await configurator.getAddress(),
      0n,
      20n,
    );
    book = await (
      await ethers.getContractFactory("OrderBook")
    ).deploy(
      await factory.getAddress(),
      await market.getAddress(),
      await usdc.getAddress(),
      await revenue.getAddress(),
      0n,
    );
    await revenue.setMarket(await market.getAddress(), true);
    await factory.setMarket(await market.getAddress());
    await revenue.setMarket(await book.getAddress(), true);
    await ap.setMarketMaker(await market.getAddress());
    await ap.setOracleFactory(await factory.getAddress());
    await graduateHandle(handleFactory, h("btc"), alice, oracle);
    for (const who of [alice, bob]) {
      await usdc.mint(who.address, 1_000_000n * ONE);
      await usdc
        .connect(who)
        .approve(await market.getAddress(), 1_000_000n * ONE);
      await usdc
        .connect(who)
        .approve(await book.getAddress(), 1_000_000n * ONE);
    }
    const start = await startOf();
    await market
      .connect(oracle)
      .openWindow(
        h("btc"),
        start,
        start + 600n,
        ["YES", "NO"],
        [
          JSON.stringify({ handle: "btc", outcome: 0, name: "YES" }),
          JSON.stringify({ handle: "btc", outcome: 1, name: "NO" }),
        ],
        uniformProbs(2),
        JSON.stringify({ handle: "btc", strike: 85, outcomes: ["YES", "NO"] }),
        100_000n * ONE,
      );
    wo = await ethers.getContractAt(
      "Oracle",
      await factory.oracleOf(h("btc"), start),
    );
    woAddr = await wo.getAddress();
  });

  it("a resting sell order is filled by a taker buy (shares out, USDC in)", async () => {
    // Alice buys NO (outcome 1) shares on the market, then sells 50 on the book.
    await market.connect(alice).buy(wo, 1n, 100n * ONE, 0n);
    const qA = await market.shares(alice.address, woAddr, 1n);
    await market.connect(alice).approve(wo, 1n, qA);
    const sellId = await book.nextOrderId();
    await book
      .connect(alice)
      .placeOrder(wo, 1n, false, 5n * 10n ** 17n, 50n * ONE, 0n);

    const bBefore = await usdc.balanceOf(bob.address);
    await book
      .connect(bob)
      .marketOrder(
        wo,
        1n,
        true,
        [sellId],
        50n * ONE,
        6n * 10n ** 17n,
        50n * ONE,
      );
    expect((await usdc.balanceOf(bob.address)) - bBefore).to.equal(-25n * ONE); // 50 @ 0.5
    expect(await market.shares(bob.address, woAddr, 1n)).to.equal(50n * ONE);
    expect(await market.shares(alice.address, woAddr, 1n)).to.equal(
      qA - 50n * ONE,
    );
  });

  it("a resting buy order is filled by a taker sell (USDC out, shares in)", async () => {
    // Bob rests a buy at 0.4 for 100 shares (escrows 40 USDC).
    const buyId = await book.nextOrderId();
    await book
      .connect(bob)
      .placeOrder(wo, 1n, true, 4n * 10n ** 17n, 100n * ONE, 0n);
    expect(await usdc.balanceOf(await book.getAddress())).to.equal(40n * ONE);

    // Alice buys DOWN on the market, approves, then sells 100 into Bob's order.
    await market.connect(alice).buy(wo, 1n, 200n * ONE, 0n);
    const qA = await market.shares(alice.address, woAddr, 1n);
    expect(qA).to.be.greaterThan(100n * ONE);
    await market.connect(alice).approve(wo, 1n, qA);
    const aBefore = await usdc.balanceOf(alice.address);
    await book
      .connect(alice)
      .marketOrder(
        wo,
        1n,
        false,
        [buyId],
        100n * ONE,
        3n * 10n ** 17n,
        100n * ONE,
      );
    expect((await usdc.balanceOf(alice.address)) - aBefore).to.equal(40n * ONE); // 100 @ 0.4
    expect(await market.shares(bob.address, woAddr, 1n)).to.equal(100n * ONE);
  });

  it("cancels an order and returns the escrow", async () => {
    const id = await book.nextOrderId();
    await book
      .connect(bob)
      .placeOrder(wo, 1n, true, 4n * 10n ** 17n, 100n * ONE, 0n);
    const before = await usdc.balanceOf(bob.address);
    await book.connect(bob).cancelOrder(wo, id);
    expect((await usdc.balanceOf(bob.address)) - before).to.equal(40n * ONE);
  });

  it("updates an order price and size (re-escrows the delta)", async () => {
    const id = await book.nextOrderId();
    await book
      .connect(bob)
      .placeOrder(wo, 1n, true, 4n * 10n ** 17n, 100n * ONE, 0n);
    const before = await usdc.balanceOf(bob.address);
    await book
      .connect(bob)
      .updateOrder(wo, id, 5n * 10n ** 17n, 100n * ONE, 0n); // 0.4 → 0.5
    expect((await usdc.balanceOf(bob.address)) - before).to.equal(-10n * ONE);
  });

  it("enforces slippage and rejects bad prices", async () => {
    await expectError(
      book.connect(bob).placeOrder(wo, 1n, true, 0n, 100n * ONE, 0n),
      "BadPrice",
    );
    // Sell rests at 0.6; taker's limit 0.5 → no fill.
    await market.connect(alice).buy(wo, 1n, 100n * ONE, 0n);
    const qA = await market.shares(alice.address, woAddr, 1n);
    await market.connect(alice).approve(wo, 1n, qA);
    const sellId = await book.nextOrderId();
    await book
      .connect(alice)
      .placeOrder(wo, 1n, false, 6n * 10n ** 17n, 50n * ONE, 0n);
    await expectError(
      book
        .connect(bob)
        .marketOrder(
          wo,
          1n,
          true,
          [sellId],
          50n * ONE,
          5n * 10n ** 17n,
          50n * ONE,
        ),
      "BelowMinFill",
    );
  });
});
