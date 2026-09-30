import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";
import {
  h,
  expectError,
  deployOracleFactory,
  graduateHandle,
  uniformProbs,
  resolveWindow,
} from "./registry.test";

const ORACLE_PK =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ONE = 10n ** 18n;
const INDEX = 100n; // 1e2 scale: 85.00 → 8500

describe("MarketMaker (binary LMSR, Pool-backed)", () => {
  let usdc: Contract;
  let registry: Contract;
  let factory: Contract;
  let market: Contract;
  let handleFactory: Contract;
  let revenue: Contract;
  let poolC: Contract;
  let oracle: any;
  let alice: any;
  let bob: any;

  const startOf = async (): Promise<bigint> =>
    BigInt((await ethers.provider.getBlock("latest"))!.timestamp);

  const open = async (
    handleId: string,
    start: bigint,
    outcomes: string[],
    strike: bigint,
    funding = 500_000n * ONE,
    probs: bigint[] = uniformProbs(outcomes.length),
  ) => {
    const metadata = outcomes.map((o, i) =>
      JSON.stringify({
        handle: handleId.replace(/^0x/, ""),
        outcome: i,
        name: o,
      }),
    );
    const oracleMeta = JSON.stringify({
      handle: handleId.replace(/^0x/, ""),
      windowStart: Number(start),
      strike: Number(strike),
      outcomes,
    });
    return market
      .connect(oracle)
      .openWindow(
        handleId,
        start,
        start + 600n,
        outcomes,
        metadata,
        probs,
        oracleMeta,
        funding,
      );
  };

  const wo = async (handleId: string, start: bigint): Promise<Contract> =>
    ethers.getContractAt("Oracle", await factory.oracleOf(handleId, start));

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
    await registry.registerHandle(h("elon"), 15);
    const aura = await (await ethers.getContractFactory("AuraToken")).deploy();
    const configurator = await (
      await ethers.getContractFactory("Configurator")
    ).deploy();
    const ap = await (
      await ethers.getContractFactory("AddressesProvider")
    ).deploy();
    handleFactory = await (
      await ethers.getContractFactory("HandleFactory")
    ).deploy(
      await aura.getAddress(),
      await usdc.getAddress(),
      await configurator.getAddress(),
      await ap.getAddress(),
    );
    poolC = await (
      await ethers.getContractFactory("Pool")
    ).deploy(
      "Aura Pool",
      "AURALP",
      await usdc.getAddress(),
      await ap.getAddress(),
    );
    revenue = await (
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
    );
    await revenue.setMarket(await market.getAddress(), true);
    await factory.setMarket(await market.getAddress());
    await ap.setMarketMaker(await market.getAddress());
    await ap.setOracleFactory(await factory.getAddress());
    await ap.setPool(await poolC.getAddress());
    await graduateHandle(handleFactory, h("btc"), alice, oracle);
    await graduateHandle(handleFactory, h("elon"), alice, oracle);
    for (const who of [alice, bob]) {
      await usdc.mint(who.address, 1_000_000n * ONE);
      await usdc
        .connect(who)
        .approve(await market.getAddress(), 1_000_000n * ONE);
    }
    // Bob also funds the LP pool — keep extra USDC so he can still trade.
    await usdc.mint(bob.address, 1_000_000n * ONE);
    await usdc.connect(bob).approve(await poolC.getAddress(), 1_000_000n * ONE);
    await poolC.connect(bob).deposit(1_000_000n * ONE);
  });

  it("binary YES/NO: prices sum to 1, close above strike settles YES", async () => {
    const start = await startOf();
    await open(h("elon"), start, ["YES", "NO"], 85n * INDEX);
    const woO = await wo(h("elon"), start);

    // At open (no shares), both outcomes are 50/50.
    const pYes = await market.priceOf(woO, 0n);
    const pNo = await market.priceOf(woO, 1n);
    expect(pYes + pNo).to.be.closeTo(ONE, ONE / 100n);
    expect(pYes).to.be.closeTo(ONE / 2n, ONE / 100n);

    // Alice buys YES with 100 USDC; price shifts above 0.5 (YES favored).
    await market.connect(alice).buy(woO, 0n, 100n * ONE, 0n);
    const qYes = await market.shares(alice.address, await woO.getAddress(), 0n);
    expect(qYes).to.be.greaterThan(0n);
    const pYes2 = await market.priceOf(woO, 0n);
    expect(pYes2).to.be.greaterThan(ONE / 2n);

    // Settle: close 90 > strike 85 → YES wins; claim pays 1:1.
    await ethers.provider.send("evm_increaseTime", [600]);
    await ethers.provider.send("evm_mine", []);
    await resolveWindow({ wo: woO, signer: oracle, handleId: h("elon"), windowStart: start, windowEnd: start + 600n });
    await market.connect(oracle).settle(woO, 0n); // close 90 > strike 85 → YES
    const before = await usdc.balanceOf(alice.address);
    await market.connect(alice).claim(woO, 0n);
    expect((await usdc.balanceOf(alice.address)) - before).to.equal(qYes);
    await expectError(market.connect(bob).claim(woO, 1n), "NothingToRedeem");
  });

  it("initial probabilities seed the LMSR prices at open", async () => {
    const start = await startOf();
    // 30/70 binary — the relayer priced the open (not a flat 50/50).
    await open(
      h("elon"),
      start,
      ["YES", "NO"],
      50n * INDEX,
      500_000n * ONE,
      [3n * 10n ** 17n, 7n * 10n ** 17n],
    );
    const woO = await wo(h("elon"), start);
    expect(await market.priceOf(woO, 0n)).to.be.closeTo(3n * 10n ** 17n, ONE / 100n);
    expect(await market.priceOf(woO, 1n)).to.be.closeTo(7n * 10n ** 17n, ONE / 100n);

    // Probabilities must sum to exactly 1e18 — 30/30 is rejected.
    await expectError(
      open(
        h("elon"),
        (await startOf()) + 700n,
        ["YES", "NO"],
        50n * INDEX,
        500_000n * ONE,
        [3n * 10n ** 17n, 3n * 10n ** 17n],
      ),
      "BadOutcome",
    );
  });

  it("windows are backed by the singleton Pool (reserve → payout → finalize)", async () => {
    const start = await startOf();
    await open(h("elon"), start, ["YES", "NO"], 85n * INDEX, 200_000n * ONE);
    const woO = await wo(h("elon"), start);
    expect(await poolC.reserved(await woO.getAddress())).to.equal(
      200_000n * ONE,
    );

    await market.connect(alice).buy(woO, 0n, 100n * ONE, 0n);
    const q = await market.shares(alice.address, await woO.getAddress(), 0n);
    await ethers.provider.send("evm_increaseTime", [600]);
    await ethers.provider.send("evm_mine", []);
    await resolveWindow({ wo: woO, signer: oracle, handleId: h("elon"), windowStart: start, windowEnd: start + 600n });
    await market.connect(oracle).settle(woO, 0n); // close 90 > strike 85 → YES
    const before = await usdc.balanceOf(alice.address);
    await market.connect(alice).claim(woO, 0n);
    expect((await usdc.balanceOf(alice.address)) - before).to.equal(q); // paid from reserve

    // Finalize is grace-gated: claims must have time to land first.
    await expectError(market.finalize(woO), "TooEarly");
    await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 10]);
    await ethers.provider.send("evm_mine", []);
    await market.finalize(woO);
    expect(await poolC.reserved(await woO.getAddress())).to.equal(0n);
    // LPs can withdraw what is still idle (principal − payout + premium).
    const pBefore = await usdc.balanceOf(bob.address);
    await poolC.connect(bob).withdraw(await poolC.balanceOf(bob.address));
    expect((await usdc.balanceOf(bob.address)) - pBefore).to.be.lessThan(
      1_000_000n * ONE,
    );
  });

  it("rejects non-binary outcome sets and trading outside the window", async () => {
    const start = await startOf();
    // The multi-outcome concept is gone: any set other than exactly 2 reverts.
    await expectError(open(h("elon"), start, ["A", "B", "C"], 50n * INDEX), "BadOutcome");
    await expectError(open(h("elon"), start, ["ONLY"], 50n * INDEX), "BadOutcome");

    await open(h("elon"), start, ["YES", "NO"], 85n * INDEX);
    const woO = await wo(h("elon"), start);
    await ethers.provider.send("evm_increaseTime", [605]);
    await ethers.provider.send("evm_mine", []);
    await expectError(
      market.connect(alice).buy(woO, 0n, 10n * ONE, 0n),
      "WindowNotOpen",
    );
  });

  it("outcome prices always sum to 1 as money flows in", async () => {
    const start = await startOf();
    await open(h("elon"), start, ["YES", "NO"], 50n * INDEX);
    const woO = await wo(h("elon"), start);

    const checkSum = async (): Promise<void> => {
      const [a, b] = await Promise.all([
        market.priceOf(woO, 0n),
        market.priceOf(woO, 1n),
      ]);
      expect(a + b).to.be.closeTo(ONE, ONE / 1000n);
    };
    await checkSum();

    await market.connect(alice).buy(woO, 0n, 200n * ONE, 0n);
    await checkSum();
    await market.connect(bob).buy(woO, 1n, 300n * ONE, 0n);
    await checkSum();
    // The side with the most money is favored.
    expect(await market.priceOf(woO, 1n)).to.be.greaterThan(
      await market.priceOf(woO, 0n),
    );
  });

  it("live sell returns the LMSR proceeds and burns shares", async () => {
    const start = await startOf();
    await open(h("elon"), start, ["YES", "NO"], 85n * INDEX);
    const woO = await wo(h("elon"), start);
    await market.connect(alice).buy(woO, 0n, 100n * ONE, 0n);
    const q = await market.shares(alice.address, await woO.getAddress(), 0n);
    expect(q).to.be.greaterThan(0n);

    const before = await usdc.balanceOf(alice.address);
    await market.connect(alice).sell(woO, 0n, q, 1n);
    const proceeds = (await usdc.balanceOf(alice.address)) - before;
    expect(proceeds).to.be.greaterThan(0n);
    expect(proceeds).to.be.lessThan(q); // sold below 1.0
    expect(
      await market.shares(alice.address, await woO.getAddress(), 0n),
    ).to.equal(0n);
  });

  it("a losing holder cannot claim; only the winning outcome pays", async () => {
    const start = await startOf();
    await open(h("elon"), start, ["YES", "NO"], 0n);
    const woO = await wo(h("elon"), start);
    await market.connect(alice).buy(woO, 1n, 100n * ONE, 0n); // holds NO
    const q = await market.shares(alice.address, await woO.getAddress(), 1n);

    await ethers.provider.send("evm_increaseTime", [600]);
    await ethers.provider.send("evm_mine", []);
    // Direction true → YES (index 0) wins; alice's NO is worthless.
    await resolveWindow({ wo: woO, signer: oracle, handleId: h("elon"), windowStart: start, windowEnd: start + 600n });
    await market.connect(oracle).settle(woO, 0n);
    expect(
      (await market.windows(await woO.getAddress())).winningOutcome,
    ).to.equal(0n);
    await expectError(market.connect(alice).claim(woO, 1n), "NothingToRedeem");
    expect(q).to.be.greaterThan(0n);
  });

  it("mints OutcomeToken ERC20 receipts (with metadata) on buy, burns on sell/claim", async () => {
    const start = await startOf();
    await open(h("elon"), start, ["YES", "NO"], 85n * INDEX);
    const woO = await wo(h("elon"), start);
    const woAddr = await woO.getAddress();

    // No token until someone trades.
    const beforeAddr = await market.outcomeTokenOf(woO, 0n);
    const zero =
      typeof beforeAddr === "string"
        ? beforeAddr
        : await (beforeAddr as Contract).getAddress();
    expect(zero).to.equal(ethers.ZeroAddress);

    // Buy YES → an OutcomeToken is deployed and alice is minted shares.
    await market.connect(alice).buy(woO, 0n, 100n * ONE, 0n);
    const tokenAddr = await market.outcomeTokenOf(woO, 0n);
    const token = await ethers.getContractAt(
      "OutcomeToken",
      typeof tokenAddr === "string"
        ? tokenAddr
        : await (tokenAddr as Contract).getAddress(),
    );
    const q = await market.shares(alice.address, woAddr, 0n);

    expect(await token.balanceOf(alice.address)).to.equal(q);
    expect(await token.oracle()).to.equal(woAddr);
    expect(await token.outcome()).to.equal(0n);
    const meta = await token.metadata();
    expect(meta).to.include('"outcome":0');
    expect(meta).to.include('"name":"YES"');

    // Transfers move the ERC20 too.
    await market.connect(alice).approve(woO, 0n, q);
    await market
      .connect(alice)
      .transferFrom(alice.address, bob.address, woO, 0n, q / 2n);
    expect(await token.balanceOf(bob.address)).to.equal(q / 2n);
    expect(await token.balanceOf(alice.address)).to.equal(q / 2n);

    // Claim burns the winning receipt.
    await ethers.provider.send("evm_increaseTime", [600]);
    await ethers.provider.send("evm_mine", []);
    await resolveWindow({ wo: woO, signer: oracle, handleId: h("elon"), windowStart: start, windowEnd: start + 600n });
    await market.connect(oracle).settle(woO, 0n); // close 90 > strike 85 → YES
    await market.connect(alice).claim(woO, 0n);
    expect(await token.balanceOf(alice.address)).to.equal(0n);
  });

  // ------------------------------------------------------------------
  // Invariants — the properties the audit's money bugs violated.
  // ------------------------------------------------------------------

  it("invariant: a buy followed immediately by a sell cannot profit", async () => {
    const start = await startOf();
    await open(h("elon"), start, ["YES", "NO"], 50n * INDEX, 200_000n * ONE);
    const woO = await wo(h("elon"), start);

    const before = await usdc.balanceOf(alice.address);
    const budget = 50_000n * ONE; // large vs the window's depth: convexity is real
    await market.connect(alice).buy(woO, 0n, budget, 0n);
    const afterBuy = await usdc.balanceOf(alice.address);
    const spent = before - afterBuy;

    const shares = await market.shares(alice.address, await woO.getAddress(), 0n);
    await market.connect(alice).sell(woO, 0n, shares, 0n);
    const afterSell = await usdc.balanceOf(alice.address);
    const returned = afterSell - afterBuy;

    // The exact-cost buy must not be an instant round-trip profit.
    expect(returned).to.be.lessThanOrEqual(spent);
    // And the trader is charged no more than their stated budget.
    expect(spent).to.be.lessThanOrEqual(budget);
  });

  it("invariant: a settled window rejects further trading", async () => {
    const start = await startOf();
    await open(h("elon"), start, ["YES", "NO"], 85n * INDEX, 200_000n * ONE);
    const woO = await wo(h("elon"), start);
    await market.connect(alice).buy(woO, 0n, 100n * ONE, 0n);
    await resolveWindow({ wo: woO, signer: oracle, handleId: h("elon"), windowStart: start, windowEnd: start + 600n });
    await market.connect(oracle).settle(woO, 0n);
    // The winner is public knowledge now: buying it must be impossible.
    await expectError(market.connect(bob).buy(woO, 0n, 10n * ONE, 0n), "WindowNotOpen");
    await expectError(market.connect(bob).sell(woO, 0n, 1n, 0n), "WindowNotOpen");
  });

  it("invariant: settling without an oracle resolution reverts", async () => {
    const start = await startOf();
    await open(h("elon"), start, ["YES", "NO"], 85n * INDEX, 200_000n * ONE);
    const woO = await wo(h("elon"), start);
    await ethers.provider.send("evm_increaseTime", [600]);
    await ethers.provider.send("evm_mine", []);
    // No `resolveWindow` — the market must refuse a bare relayer-signed outcome.
    await expectError(market.connect(oracle).settle(woO, 0n), "OracleNotResolved");
  });

  it("invariant: every winner can claim even after sells drained the window cash", async () => {    const start = await startOf();
    await open(h("elon"), start, ["YES", "NO"], 85n * INDEX, 300_000n * ONE);
    const woO = await wo(h("elon"), start);

    // Bob buys then sells out — that returns his USDC from the window ledger.
    await market.connect(bob).buy(woO, 0n, 150_000n * ONE, 0n);
    const bobShares = await market.shares(bob.address, await woO.getAddress(), 0n);
    await market.connect(bob).sell(woO, 0n, bobShares, 0n);
    // Alice holds the winning side.
    await market.connect(alice).buy(woO, 0n, 100n * ONE, 0n);
    const aliceShares = await market.shares(alice.address, await woO.getAddress(), 0n);

    await resolveWindow({ wo: woO, signer: oracle, handleId: h("elon"), windowStart: start, windowEnd: start + 600n });
    await market.connect(oracle).settle(woO, 0n);

    const before = await usdc.balanceOf(alice.address);
    await market.connect(alice).claim(woO, 0n);
    expect((await usdc.balanceOf(alice.address)) - before).to.equal(aliceShares);
  });

  it("void: a voided window refunds holders and releases the reserve", async () => {
    const start = await startOf();
    await open(h("elon"), start, ["YES", "NO"], 50n * INDEX, 200_000n * ONE);
    const woO = await wo(h("elon"), start);

    await market.connect(alice).buy(woO, 0n, 500n * ONE, 0n);
    await market.connect(bob).buy(woO, 1n, 500n * ONE, 0n);
    const aliceShares = await market.shares(alice.address, await woO.getAddress(), 0n);
    const bobShares = await market.shares(bob.address, await woO.getAddress(), 1n);

    // The oracle cannot resolve → it voids the window.
    await woO.connect(oracle).voidWindow("no data for this window");
    await ethers.provider.send("evm_increaseTime", [600]);
    await ethers.provider.send("evm_mine", []);

    // Nobody can settle a voided window …
    await expectError(market.connect(oracle).settle(woO, 0n), "OracleNotResolved");
    // … and redemption returns the live value of each position, fee-free.
    const aBefore = await usdc.balanceOf(alice.address);
    await market.connect(alice).redeemVoid(woO);
    expect((await usdc.balanceOf(alice.address)) - aBefore).to.be.greaterThan(0n);
    await market.connect(bob).redeemVoid(woO);
    expect(await market.shares(alice.address, await woO.getAddress(), 0n)).to.equal(0n);
    expect(await market.shares(bob.address, await woO.getAddress(), 1n)).to.equal(0n);
    await expectError(market.connect(alice).redeemVoid(woO), "NothingToRedeem");

    // Finalize releases the (now unused) reserve back to the LPs.
    await expectError(market.finalize(woO), "TooEarly");
    await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 10]);
    await ethers.provider.send("evm_mine", []);
    await market.finalize(woO);
    expect(await poolC.reserved(await woO.getAddress())).to.equal(0n);
  });
});
