import { ethers } from "hardhat";
import { readFileSync, writeFileSync } from "node:fs";
import type { Contract } from "ethers";

/**
 * Seed the demo market — the handles the explore grid, leaderboard, feeds and
 * trade pages are built around.
 *
 *   PRIVATE_KEY=$PK ORACLE_PRIVATE_KEY=$PK npx hardhat run scripts/seed-handles.ts --network monadTestnet
 *
 * Idempotent: a handle whose `HandleFactory.handleOf` is already deployed is
 * skipped (its aura/graduation are re-asserted), so re-running after a partial
 * failure costs only the missing pieces. Each seeded handle gets:
 *   1. `MarketRegistry.registerHandle` (window length + grouped flag)
 *   2. `HandleFactory.createHandle` with metadata JSON carrying `photo`
 *   3. `setAuraUpdater` → the relayer, then `updateAura` + `setGraduated`
 *   4. its first window, opened and funded, so it is tradeable immediately.
 *
 * `photo` URLs are real, openly-licensed Wikimedia images (verified 200 +
 * image/* on 2026-09-30); `imageFit` keeps transparent logos uncropped.
 */

const ONE = 10n ** 18n;

/** Category codes: `{cat}_{sub}_{format}`, format 1 = binary, 2 = multi-outcome. */
const CAT = {
  crypto: 1_000_000,
  ai: 2_000_000,
  people: 3_000_000,
  brands: 4_000_000,
  memes: 5_000_000,
  music: 6_000_000,
  tech: 7_000_000,
  football: 100_001_000,
};

type Seed = {
  label: string;
  name: string;
  symbol: string;
  category: number;
  /** On-chain aura, 1e2 scale (3040 = 30.40). Capped at 10_000 by Handle. */
  aura: number;
  windowMinutes: number;
  /** Multi-outcome window (grouped market) instead of a binary YES/NO. */
  grouped?: boolean;
  photo: string;
  imageFit?: "cover" | "contain";
  summary: string;
};

const SEEDS: Seed[] = [
  {
    label: "ronaldo", name: "Cristiano Ronaldo", symbol: "RON", category: CAT.football + 1,
    aura: 3040, windowMinutes: 15, summary: "Portugal captain · five Champions League titles",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/26/Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg/330px-Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg",
  },
  {
    label: "messi", name: "Lionel Messi", symbol: "MESSI", category: CAT.football + 1,
    aura: 2875, windowMinutes: 15, summary: "Inter Miami · World Cup winner",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c8/Leo_Messi_Argentina_v_Egypt_7_July_2026-1.jpg/330px-Leo_Messi_Argentina_v_Egypt_7_July_2026-1.jpg",
  },
  {
    label: "mbappe", name: "Kylian Mbappé", symbol: "MBAPPE", category: CAT.football + 1,
    aura: 2410, windowMinutes: 15, summary: "Real Madrid forward · France",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/95/Kylian_Mbappe_France_v_Senegal_16_June_2026-391_%28cropped%29.jpg/330px-Kylian_Mbappe_France_v_Senegal_16_June_2026-391_%28cropped%29.jpg",
  },
  {
    // Grouped (multi-outcome): the winner is the football handle that gains the
    // most aura over the window.
    label: "football", name: "Football", symbol: "FOOT", category: CAT.football + 2,
    aura: 3600, windowMinutes: 15, grouped: true, imageFit: "contain",
    summary: "Grouped market · the football handle gaining the most aura",
    photo: "https://thumb.wikimedia.org/wikipedia/en/thumb/f/f2/Premier_League_Logo.svg/330px-Premier_League_Logo.svg.png",
  },
  {
    label: "btc", name: "Bitcoin", symbol: "BTC", category: CAT.crypto + 1,
    aura: 4150, windowMinutes: 30, imageFit: "contain", summary: "The original crypto index",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/330px-Bitcoin.svg.png",
  },
  {
    label: "eth", name: "Ethereum", symbol: "ETH", category: CAT.crypto + 1,
    aura: 3220, windowMinutes: 30, imageFit: "contain", summary: "Smart-contract settlement layer",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9d/Eth-diamond-%28color%29.svg/330px-Eth-diamond-%28color%29.svg.png",
  },
  {
    label: "sol", name: "Solana", symbol: "SOL", category: CAT.crypto + 1,
    aura: 2180, windowMinutes: 30, imageFit: "contain", summary: "High-throughput L1",
    photo: "https://upload.wikimedia.org/wikipedia/en/b/b9/Solana_logo.png",
  },
  {
    label: "openai", name: "OpenAI", symbol: "OPENAI", category: CAT.ai + 1,
    aura: 3980, windowMinutes: 60, summary: "Frontier model lab",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a7/1515_Third_Street.jpg/330px-1515_Third_Street.jpg",
  },
  {
    label: "nvidia", name: "NVIDIA", symbol: "NVDA", category: CAT.tech + 1,
    aura: 2740, windowMinutes: 60, summary: "Accelerated compute for AI",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/75/2788-2888_San_Tomas_Expwy.jpg/330px-2788-2888_San_Tomas_Expwy.jpg",
  },
  {
    label: "apple", name: "Apple", symbol: "AAPL", category: CAT.tech + 1,
    aura: 2510, windowMinutes: 60, imageFit: "contain", summary: "Consumer hardware + services",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fa/Apple_logo_black.svg/330px-Apple_logo_black.svg.png",
  },
  {
    label: "tesla", name: "Tesla", symbol: "TSLA", category: CAT.tech + 1,
    aura: 2360, windowMinutes: 60, imageFit: "contain", summary: "EVs, energy, autonomy",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bd/Tesla_Motors.svg/330px-Tesla_Motors.svg.png",
  },
  {
    label: "elon", name: "Elon Musk", symbol: "ELON", category: CAT.people + 1,
    aura: 4290, windowMinutes: 60, summary: "Founder · most-followed voice on the feed",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5e/Elon_Musk_-_54820081119_%28cropped%29.jpg/330px-Elon_Musk_-_54820081119_%28cropped%29.jpg",
  },
  {
    label: "trump", name: "Donald Trump", symbol: "TRUMP", category: CAT.people + 1,
    aura: 3110, windowMinutes: 60, summary: "US President · headline mover",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/16/Official_Presidential_Portrait_of_President_Donald_J._Trump_%282025%29.jpg/330px-Official_Presidential_Portrait_of_President_Donald_J._Trump_%282025%29.jpg",
  },
  {
    label: "taylor", name: "Taylor Swift", symbol: "TAYLOR", category: CAT.music + 1,
    aura: 3550, windowMinutes: 60, summary: "Touring + release-cycle aura",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b1/Taylor_Swift_at_the_2023_MTV_Video_Music_Awards_%283%29.png/330px-Taylor_Swift_at_the_2023_MTV_Video_Music_Awards_%283%29.png",
  },
  {
    label: "doge", name: "Dogecoin", symbol: "DOGE", category: CAT.memes + 1,
    aura: 1990, windowMinutes: 15, imageFit: "contain", summary: "The meme-coin aura index",
    photo: "https://upload.wikimedia.org/wikipedia/en/d/d0/Dogecoin_Logo.png",
  },
];

const h = (s: string): string => ethers.encodeBytes32String(s);
const ZERO = "0x0000000000000000000000000000000000000000";

async function main(): Promise<void> {
  const deployments = JSON.parse(readFileSync("deployments/deployments.json", "utf8"));
  const [deployer] = await ethers.getSigners();
  const relayerPk = process.env.ORACLE_PRIVATE_KEY;
  const relayer = relayerPk ? new ethers.Wallet(relayerPk, ethers.provider) : deployer;

  const usdc = await ethers.getContractAt("MockUSDC", deployments.usdc);
  const registry = await ethers.getContractAt("MarketRegistry", deployments.marketRegistry);
  const handleFactory = await ethers.getContractAt("HandleFactory", deployments.handleFactory);
  const market = await ethers.getContractAt("MarketMaker", deployments.marketMaker);
  const pool = await ethers.getContractAt("Pool", deployments.pool);
  const oracleFactory = await ethers.getContractAt("OracleFactory", deployments.oracleFactory);

  console.log(`\nDeployer ${deployer.address}\nRelayer  ${relayer.address}\n`);

  // --- liquidity: the relayer opens the windows, the vault backs the payouts ---
  const relayerUsdc = await usdc.balanceOf(relayer.address);
  if (relayerUsdc < 20_000n * ONE) {
    await (await usdc.mint(relayer.address, 200_000n * ONE)).wait();
    console.log("minted 200,000 mUSDC to the relayer");
  }
  const allowance = await usdc.allowance(relayer.address, deployments.marketMaker);
  if (allowance < 100_000n * ONE) {
    await (await usdc.connect(relayer).approve(deployments.marketMaker, 100_000n * ONE)).wait();
    console.log("relayer approved the market for 100,000 mUSDC");
  }
  // Window payouts draw on the Pool's idle cash: keep it comfortably funded.
  const idle: bigint = await pool.idle();
  const need = BigInt(SEEDS.length + 4) * 1_000n * ONE;
  if (idle < need) {
    const target = need * 2n;
    await (await usdc.mint(deployer.address, target)).wait();
    await (await usdc.approve(deployments.pool, target)).wait();
    await (await pool.deposit(target)).wait();
    console.log(`deposited ${Number(target / ONE).toLocaleString()} mUSDC into the pool`);
  }

  const footballMembers = SEEDS.filter((s) => s.category === CAT.football + 1).map((s) => s.label);
  const handles: Record<string, unknown> = { ...(deployments.handles ?? {}) };
  let created = 0;
  let opened = 0;

  for (const s of SEEDS) {
    const id = h(s.label);
    let handleAddress: string = await handleFactory.handleOf(id);

    if (handleAddress === ZERO) {
      if (!(await registry.isRegistered(id))) {
        await (await registry.registerHandle(id, s.windowMinutes, Boolean(s.grouped))).wait();
      }
      const metadata = JSON.stringify({
        name: s.name,
        symbol: s.symbol,
        photo: s.photo,
        imageFit: s.imageFit ?? "cover",
        category: `${s.category}`,
      });
      await (
        await handleFactory.createHandle(
          id,
          deployer.address,
          s.name,
          s.symbol,
          metadata,
          BigInt(s.windowMinutes),
          BigInt(s.category),
        )
      ).wait();
      handleAddress = await handleFactory.handleOf(id);
      created += 1;
    }

    const handle: Contract = await ethers.getContractAt("Handle", handleAddress);
    // The relayer is the protocol's aura updater (and the curator fallback), so
    // it can push aura, edit metadata and graduate the handle.
    if ((await handle.auraUpdater()).toLowerCase() !== relayer.address.toLowerCase()) {
      await (await handleFactory.setAuraUpdater(id, relayer.address)).wait();
    }
    // Refresh the metadata JSON every run: the photo/fit/name live here, and the
    // app reads them off the subgraph — an older handle created without a photo
    // (the original deploy seed) gets one now.
    await (
      await handle.connect(relayer).setMetadata(
        JSON.stringify({
          name: s.name,
          symbol: s.symbol,
          photo: s.photo,
          imageFit: s.imageFit ?? "cover",
          category: `${s.category}`,
        }),
      )
    ).wait();
    await (await handle.connect(relayer).updateAura(BigInt(s.aura), s.summary)).wait();
    await (await handle.connect(relayer).setGraduated(true)).wait();

    // First window: binary handles get a 50/50 YES/NO, the grouped handle gets
    // one outcome per football member. A revert means one is already open (the
    // market allows a single live window per handle) — nothing to do.
    //
    // The window ORACLE is now also opened by the oracle engine at every slot
    // boundary, so bootstrap ONLY when the current slot has no window — opening a
    // second one would give the handle two live windows at once.
    const span = BigInt(s.windowMinutes * 60);
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const slotStart = (nowSec / span) * span;
    if ((await oracleFactory.oracleOf(id, slotStart)) !== ethers.ZeroAddress) {
      console.log(`  · @${s.label.padEnd(9)} the engine already opened slot ${slotStart} — skipped`);
      handles[s.label] = {
        id,
        contract: handleAddress,
        stake: await handleFactory.stakeOf(id),
        category: s.category,
        grouped: Boolean(s.grouped),
        aura: s.aura,
        graduated: true,
        photo: s.photo,
        windowMinutes: s.windowMinutes,
      };
      continue;
    }
    const block = await ethers.provider.getBlock("latest");
    const start = BigInt(block ? block.timestamp : Math.floor(Date.now() / 1000));
    const end = start + BigInt(s.windowMinutes * 60);
    const outcomes = s.grouped ? footballMembers : ["YES", "NO"];
    const probabilities: bigint[] = s.grouped
      ? outcomes.map(() => ONE / BigInt(outcomes.length))
      : [ONE / 2n, ONE / 2n];
    // The LMSR seed probabilities must sum to exactly 1e18.
    if (s.grouped) {
      probabilities[0] += ONE - probabilities.reduce((a, b) => a + b, 0n);
    }
    try {
      await (
        await market.connect(relayer).openWindow(
          id,
          start,
          end,
          outcomes,
          outcomes.map((name, outcome) => JSON.stringify({ handle: s.label, outcome, name })),
          probabilities,
          JSON.stringify({
            question: s.grouped
              ? "Who will gain the highest aura from window start to end?"
              : `Will @${s.label} aura rise above ${(s.aura / 100).toFixed(2)}?`,
            style: s.grouped ? "multi" : "binary",
            category: s.category,
            handle: s.label,
          }),
          1_000n * ONE,
        )
      ).wait();
      opened += 1;
      console.log(`  ✓ @${s.label.padEnd(9)} window ${start} → ${end} (${outcomes.join(" / ")})`);
    } catch (error) {
      const message = (error as Error).message;
      // ONLY "a window is already open for this handle" is benign here; anything
      // else (out of gas, RPC rejection) must surface, or the seed silently
      // reports success for handles it never actually brought up.
      const alreadyOpen = /window.*(already|open)|AlreadyOpen|AlreadyResolved/i.test(message);
      if (!alreadyOpen) throw error;
      console.log(`  · @${s.label.padEnd(9)} window already open — skipped`);
    }

    handles[s.label] = {
      id,
      contract: handleAddress,
      stake: await handleFactory.stakeOf(id),
      category: s.category,
      grouped: Boolean(s.grouped),
      aura: s.aura,
      graduated: true,
      photo: s.photo,
      windowMinutes: s.windowMinutes,
    };
  }

  deployments.handles = handles;
  writeFileSync("deployments/deployments.json", `${JSON.stringify(deployments, null, 2)}\n`);
  console.log(
    `\nSeeded ${created} new handle(s), opened ${opened} window(s) — total seeded: ${SEEDS.length}.\n` +
      `Wrote deployments/deployments.json\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
