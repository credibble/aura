import { ethers } from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import type { Contract } from "ethers";

/**
 * Aura complete deployment + seed script.
 *
 * Deploys the whole protocol in one pass (MockUSDC on testnets, real USDC on
 * mainnet via USDC_ADDRESS), wires the AddressesProvider/RevenueSharing/Pool,
 * then seeds ONE easy binary handle: @ronaldo (sport/football binary,
 * category 100_001_001, aura 30.40, graduated) with its first YES/NO window
 * opened at 50/50.
 *
 *   npx hardhat run scripts/deploy.ts --network localhost      (local node)
 *   PRIVATE_KEY=0x.. RPC_URL=... npx hardhat run scripts/deploy.ts --network monadTestnet
 *
 * Writes `deployments.json` (addresses for the oracle backend env).
 */

const ONE = 10n ** 18n;
const CATEGORY_SPORTS = 3n;
/// Categorisation is a set: @ronaldo is BOTH a sport/football handle and a
/// people handle, which exercises the multi-category path from the seed on.
const CATEGORY_PEOPLE_BINARY = 3_000_001n;
const RONALDO = ethers.encodeBytes32String("ronaldo");

const h = (s: string): string => ethers.encodeBytes32String(s);

const ADDR = (s: string): string => s;

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  console.log(`\nDeployer: ${deployer.address}\n`);

  // The oracle relayer: ORACLE_PRIVATE_KEY (or the deployer on localhost).
  const relayerPk = process.env.ORACLE_PRIVATE_KEY;
  const relayer = relayerPk
    ? new ethers.Wallet(relayerPk, ethers.provider)
    : deployer;

  // --- deploy ------------------------------------------------------------

  const usdc =
    process.env.USDC_ADDRESS
      ? await ethers.getContractAt("MockUSDC", ADDR(process.env.USDC_ADDRESS))
      : await (await ethers.getContractFactory("MockUSDC")).deploy();
  const aura = await (await ethers.getContractFactory("AuraToken")).deploy();
  const configurator = await (await ethers.getContractFactory("Configurator")).deploy();
  const ap = await (await ethers.getContractFactory("AddressesProvider")).deploy();
  const registry = await (
    await ethers.getContractFactory("MarketRegistry")
  ).deploy(await usdc.getAddress());
  const feeCollector = await (await ethers.getContractFactory("FeeCollector")).deploy();
  const oracleFactory = await (
    await ethers.getContractFactory("OracleFactory")
  ).deploy(await registry.getAddress(), relayer.address);
  const handleFactory = await (
    await ethers.getContractFactory("HandleFactory")
  ).deploy(await aura.getAddress(), await usdc.getAddress(), await configurator.getAddress(), await ap.getAddress());
  const pool = await (
    await ethers.getContractFactory("Pool")
  ).deploy("Aura Pool", "AURALP", await usdc.getAddress(), await ap.getAddress());
  const revenue = await (
    await ethers.getContractFactory("RevenueSharing")
  ).deploy(await usdc.getAddress(), await handleFactory.getAddress());
  const market = await (
    await ethers.getContractFactory("MarketMaker")
  ).deploy(
    await oracleFactory.getAddress(),
    await usdc.getAddress(),
    await revenue.getAddress(),
    await handleFactory.getAddress(),
    await configurator.getAddress(),
    0n, // feeBips
  );
  const book = await (
    await ethers.getContractFactory("OrderBook")
  ).deploy(
    await oracleFactory.getAddress(),
    await market.getAddress(),
    await usdc.getAddress(),
    await revenue.getAddress(),
    0n,
  );

  // --- wire the AddressesProvider (single source of truth) ---------------

  await (await ap.setUsdc(await usdc.getAddress())).wait();
  await (await ap.setAuraToken(await aura.getAddress())).wait();
  await (await ap.setOracleFactory(await oracleFactory.getAddress())).wait();
  await (await ap.setHandleFactory(await handleFactory.getAddress())).wait();
  await (await ap.setMarketMaker(await market.getAddress())).wait();
  await (await ap.setOrderBook(await book.getAddress())).wait();
  await (await ap.setRevenueSharing(await revenue.getAddress())).wait();
  await (await ap.setPool(await pool.getAddress())).wait();
  await (await ap.setConfigurator(await configurator.getAddress())).wait();

  await (await revenue.setProtocol(deployer.address)).wait();
  await (await revenue.setFeeCollector(await feeCollector.getAddress())).wait();
  await (await revenue.setMarket(await market.getAddress(), true)).wait();
  await (await revenue.setMarket(await book.getAddress(), true)).wait();
  // The OracleFactory only lets its trusted market deploy window oracles — wire
  // it here (one-shot) so `openWindow` can create/resolve windows.
  await (await oracleFactory.setMarket(await market.getAddress())).wait();

  // --- seed @ronaldo (sport/football binary, easy 50/50 YES/NO) ----------

  await (await registry.registerHandle(h("ronaldo"), 15)).wait();
  await (
    await handleFactory.createHandle(
      RONALDO,
      deployer.address,
      "Ronaldo",
      "RON",
      JSON.stringify({
        name: "Cristiano Ronaldo",
        categories: ["sport/football/binary", "people/binary"],
      }),
      15n,
      [CATEGORY_SPORTS, CATEGORY_PEOPLE_BINARY],
    )
  ).wait();

  const handle = await ethers.getContractAt("Handle", await handleFactory.handleOf(RONALDO));
  await (await handleFactory.setAuraUpdater(RONALDO, relayer.address)).wait();
  await (await handle.connect(relayer).updateAura(3040n, "Deployment seed — Cristiano Ronaldo aura 30.40")).wait(); // 30.40 aura
  await (await handle.connect(relayer).setGraduated(true)).wait();
  console.log(`Seeded @ronaldo (${await handle.getAddress()}) — graduated, aura 30.40`);

  // --- open @ronaldo's first binary window -------------------------------

  const block = await ethers.provider.getBlock("latest");
  const start = block ? block.timestamp : Math.floor(Date.now() / 1000);
  const end = start + 15 * 60; // 15-minute window

  // Fund the relayer (gas + USDC + market approval) — no-op on localhost
  // when relayer === deployer.
  if (relayer.address !== deployer.address) {
    await (await deployer.sendTransaction({ to: relayer.address, value: ethers.parseEther("1") })).wait();
  }
  await (await usdc.mint(relayer.address, 100_000n * ONE)).wait();
  await (await usdc.connect(relayer).approve(await market.getAddress(), 100_000n * ONE)).wait();

  // Seed the auraLP Pool so `openWindow`'s reserve (1k USDC) has idle liquidity.
  await (await usdc.mint(deployer.address, 10_000n * ONE)).wait();
  await (await usdc.connect(deployer).approve(await pool.getAddress(), 10_000n * ONE)).wait();
  await (await pool.connect(deployer).deposit(10_000n * ONE)).wait();

  await (
    await market.connect(relayer).openWindow(
      RONALDO,
      BigInt(start),
      BigInt(end),
      ["YES", "NO"],
      [
        JSON.stringify({ handle: "ronaldo", outcome: 0, name: "YES" }),
        JSON.stringify({ handle: "ronaldo", outcome: 1, name: "NO" }),
      ],
      [5n * 10n ** 17n, 5n * 10n ** 17n], // 50/50 initial probabilities
      JSON.stringify({
        question: "Will @ronaldo aura rise above 30.40?",
        style: "binary",
        categories: [Number(CATEGORY_SPORTS), Number(CATEGORY_PEOPLE_BINARY)],
        sub: "football",
      }),
      1_000n * ONE, // min 1k USDC funding
    )
  ).wait();
  console.log(`Opened @ronaldo binary window ${start} → ${end} (funding 1,000 USDC)`);

  // --- write deployments.json --------------------------------------------

  // Creation block per contract — the subgraph's startBlocks (index from the
  // first block that can contain each contract's events).
  const blockOf = async (c: Contract): Promise<number> => {
    const tx = c.deploymentTransaction();
    if (!tx) return 0;
    const receipt = await tx.wait();
    return receipt?.blockNumber ?? 0;
  };
  const startBlocks = {
    usdc: await blockOf(usdc),
    auraToken: await blockOf(aura),
    configurator: await blockOf(configurator),
    addressesProvider: await blockOf(ap),
    marketRegistry: await blockOf(registry),
    feeCollector: await blockOf(feeCollector),
    oracleFactory: await blockOf(oracleFactory),
    handleFactory: await blockOf(handleFactory),
    pool: await blockOf(pool),
    revenueSharing: await blockOf(revenue),
    marketMaker: await blockOf(market),
    orderBook: await blockOf(book),
  };

  const deployments = {
    chainId: (await ethers.provider.getNetwork()).chainId,
    deployer: deployer.address,
    relayer: relayer.address,
    startBlocks,
    usdc: await usdc.getAddress(),
    auraToken: await aura.getAddress(),
    configurator: await configurator.getAddress(),
    addressesProvider: await ap.getAddress(),
    marketRegistry: await registry.getAddress(),
    feeCollector: await feeCollector.getAddress(),
    oracleFactory: await oracleFactory.getAddress(),
    handleFactory: await handleFactory.getAddress(),
    pool: await pool.getAddress(),
    revenueSharing: await revenue.getAddress(),
    marketMaker: await market.getAddress(),
    orderBook: await book.getAddress(),
    handles: {
      ronaldo: {
        id: RONALDO,
        contract: await handle.getAddress(),
        stake: await handleFactory.stakeOf(RONALDO),
        categories: [Number(CATEGORY_SPORTS), Number(CATEGORY_PEOPLE_BINARY)],
        aura: 3040,
        graduated: true,
      },
    },
  };
  mkdirSync("deployments", { recursive: true });
  writeFileSync(
    "deployments/deployments.json",
    JSON.stringify(deployments, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  );
  console.log("\nWrote deployments/deployments.json");
  console.log("Oracle env mapping:");
  console.log(`  MARKET_MAKER_ADDRESS=${deployments.marketMaker}`);
  console.log(`  ORACLE_FACTORY_ADDRESS=${deployments.oracleFactory}`);
  console.log(`  SUBGRAPH_URL=<your subgraph>`);
  console.log(`  RPC_URL=<rpc>`);
  console.log(`  ORACLE_PRIVATE_KEY=<relayer key>`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});