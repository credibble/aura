import { ethers } from "hardhat";
import { readFileSync, writeFileSync } from "node:fs";
import type { Contract } from "ethers";

/**
 * Seed the demo market — 10 handles, each with SOURCES THAT ARE ABOUT IT.
 *
 *   PRIVATE_KEY=$PK ORACLE_PRIVATE_KEY=$PK npx hardhat run scripts/seed-handles.ts --network monadTestnet
 *
 * SOURCING RULE (the point of this list): a handle's sources must be *scoped to
 * that handle*, never a general outlet desk. "@ronaldo" reads an exact-phrase
 * feed for "Cristiano Ronaldo", not a football section that mostly talks about
 * other players. Every feed below was verified to return 90+ items about its
 * handle, and each carries `topic` (drives the AI's <<MENTION>> flag) and
 * `context` (tells the model what the outlet is and how to read it).
 *
 * Idempotent: an existing handle is skipped and its metadata/aura/sources are
 * refreshed; `addSource` appends only sources it doesn't already have.
 */

const ONE = 10n ** 18n;

/** Category codes: the plain on-chain list — 1 people · 2 crypto · 3 sports ·
 *  4 ai · 5 tech · 6 brands · 7 music · 8 memes · 9 culture. The UI maps a code
 *  to its family; the contracts never interpret them. */
const CAT = {
  people: 1,
  crypto: 2,
  sports: 3,
  ai: 4,
  tech: 5,
  brands: 6,
  music: 7,
  memes: 8,
  culture: 9,
};

/** A source config, exactly the shape the oracle's adapters read. */
type SourceSeed = {
  /** Adapter key: "rss" (any feed), "x" (prestige-filtered search), "reddit". */
  platform?: "rss" | "x" | "reddit";
  /** Unique per (handle, source) — becomes the source id. */
  outlet: string;
  /** rss: the feed URL. */
  feed?: string;
  /** x / reddit: the subject to search for. */
  query?: string;
  /** reddit: restrict the search to a community. */
  subreddit?: string;
  /** x: minimum author followers (default 100k); reddit: minimum post score. */
  minFollowers?: number;
  minScore?: number;
  label: string;
  /** The string the AI flags as a mention of this handle. */
  topic: string;
  /** How the model should read this feed for this handle. */
  context: string;
};

/**
 * What high-reach accounts are saying — the anti-noise source. Requires
 * `X_BEARER_TOKEN`; without it the source yields nothing (never invented data).
 */
function xTalk(label: string, query: string, minFollowers = 100_000): SourceSeed {
  return {
    platform: "x",
    outlet: `x-${label}`,
    query,
    minFollowers,
    label: `X · ${query}`,
    topic: query.split(" ").pop()!.toLowerCase(),
    context: `Posts about ${query} from accounts with ${minFollowers.toLocaleString()}+ followers (or verified). Reach is pre-filtered: score what these credible accounts report or argue, not the volume of replies.`,
  };
}

/** Community chatter about the subject, engagement-floor applied. */
function redditTalk(label: string, query: string, minScore = 50): SourceSeed {
  return {
    platform: "reddit",
    outlet: `reddit-${label}`,
    query,
    minScore,
    label: `Reddit · ${query}`,
    topic: query.split(" ").pop()!.toLowerCase(),
    context: `Reddit threads about ${query} with real traction (score ≥ ${minScore}). Community sentiment and eyewitness detail; weigh opinion down, concrete reports up.`,
  };
}

/** Google News exact-phrase feed — one query, about one subject. */
function gnews(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`"${query}" when:1d`)}&hl=en-US&gl=US&ceid=US:en`;
}

type Seed = {
  label: string;
  name: string;
  symbol: string;
  /** One or more category codes (a footballer is also a person). */
  /** On-chain category codes. */
  categories: number[];
  /** On-chain aura, 1e2 scale (3040 = 30.40). Capped at 10_000 by Handle. */
  aura: number;
  windowMinutes: number;
  photo: string;
  imageFit?: "cover" | "contain";
  summary: string;
  sources: SourceSeed[];
};

/** The handle-scoped source set for a person/brand: one exact-phrase news feed. */
function newsSource(label: string, query: string, what: string): SourceSeed {
  return {
    outlet: `gnews-${label}`,
    feed: gnews(query),
    label: `Google News · ${what}`,
    topic: query.split(" ").pop()!.toLowerCase(),
    context: `News articles matching the exact phrase "${query}" — score only what this says about ${what} (results, records, deals, injuries, controversies). Ignore pieces that merely mention ${what} in passing.`,
  };
}

const SEEDS: Seed[] = [
  {
    // A footballer is also a person — exercises the multi-category path from the
    // seed on.
    label: "ronaldo", name: "Cristiano Ronaldo", symbol: "RON", categories: [CAT.sports, CAT.people],
    aura: 3040, windowMinutes: 60, summary: "Portugal captain · five Champions League titles",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/26/Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg/330px-Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg",
    sources: [
      newsSource("ronaldo", "Cristiano Ronaldo", "Cristiano Ronaldo"),
      xTalk("ronaldo", "Cristiano Ronaldo"),
      redditTalk("ronaldo", "Cristiano Ronaldo"),
    ],
  },
  {
    label: "messi", name: "Lionel Messi", symbol: "MESSI", categories: [CAT.sports, CAT.people],
    aura: 2875, windowMinutes: 60, summary: "Inter Miami · World Cup winner",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c8/Leo_Messi_Argentina_v_Egypt_7_July_2026-1.jpg/330px-Leo_Messi_Argentina_v_Egypt_7_July_2026-1.jpg",
    sources: [
      newsSource("messi", "Lionel Messi", "Lionel Messi"),
      xTalk("messi", "Lionel Messi"),
      redditTalk("messi", "Lionel Messi"),
    ],
  },
  {
    label: "btc", name: "Bitcoin", symbol: "BTC", categories: [CAT.crypto],
    aura: 4150, windowMinutes: 60, imageFit: "contain", summary: "The original crypto index",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/330px-Bitcoin.svg.png",
    sources: [
      newsSource("btc", "Bitcoin", "Bitcoin"),
      xTalk("btc", "Bitcoin"),
      redditTalk("btc", "Bitcoin"),
    ],
  },
  {
    label: "eth", name: "Ethereum", symbol: "ETH", categories: [CAT.crypto],
    aura: 3220, windowMinutes: 60, imageFit: "contain", summary: "Smart-contract settlement layer",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9d/Eth-diamond-%28color%29.svg/330px-Eth-diamond-%28color%29.svg.png",
    sources: [
      newsSource("eth", "Ethereum", "Ethereum"),
      xTalk("eth", "Ethereum"),
      redditTalk("eth", "Ethereum"),
    ],
  },
  {
    label: "sol", name: "Solana", symbol: "SOL", categories: [CAT.crypto],
    aura: 2180, windowMinutes: 60, imageFit: "contain", summary: "High-throughput L1",
    photo: "https://upload.wikimedia.org/wikipedia/en/b/b9/Solana_logo.png",
    sources: [
      newsSource("sol", "Solana", "Solana"),
      xTalk("sol", "Solana"),
      redditTalk("sol", "Solana"),
    ],
  },
  {
    label: "openai", name: "OpenAI", symbol: "OPENAI", categories: [CAT.ai, CAT.tech],
    aura: 3980, windowMinutes: 60, summary: "Frontier model lab",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a7/1515_Third_Street.jpg/330px-1515_Third_Street.jpg",
    sources: [
      newsSource("openai", "OpenAI", "OpenAI"),
      xTalk("openai", "OpenAI"),
      redditTalk("openai", "OpenAI", 30),
      {
        // The company's own newsroom: first-party, zero editorial noise.
        outlet: "openai-news",
        feed: "https://openai.com/blog/rss.xml",
        label: "OpenAI Newsroom",
        topic: "openai",
        context: "OpenAI's own announcements - products, models, policy. First-party, so treat as the primary record of what the company shipped; newsworthiness still depends on how big the change is.",
      },
    ],
  },
  {
    label: "tesla", name: "Tesla", symbol: "TSLA", categories: [CAT.tech, CAT.people],
    aura: 2360, windowMinutes: 60, imageFit: "contain", summary: "EVs, energy, autonomy",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bd/Tesla_Motors.svg/330px-Tesla_Motors.svg.png",
    sources: [
      newsSource("tesla", "Tesla", "Tesla"),
      xTalk("tesla", "Tesla"),
      redditTalk("tesla", "Tesla"),
      {
        // A Tesla-ONLY outlet (unlike a general auto desk).
        outlet: "teslarati",
        feed: "https://www.teslarati.com/feed/",
        label: "Teslarati",
        topic: "tesla",
        context: "A Tesla-dedicated site: deliveries, launches, FSD, the share price. Single-company focus, so it runs enthusiastic — weigh product/business facts over opinion pieces.",
      },
    ],
  },
  {
    label: "elon", name: "Elon Musk", symbol: "ELON", categories: [CAT.people, CAT.tech],
    aura: 4290, windowMinutes: 60, summary: "Founder · most-followed voice on the feed",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5e/Elon_Musk_-_54820081119_%28cropped%29.jpg/330px-Elon_Musk_-_54820081119_%28cropped%29.jpg",
    sources: [
      newsSource("elon", "Elon Musk", "Elon Musk"),
      xTalk("elon", "Elon Musk"),
      redditTalk("elon", "Elon Musk"),
    ],
  },
  {
    label: "trump", name: "Donald Trump", symbol: "TRUMP", categories: [CAT.people],
    aura: 3110, windowMinutes: 60, summary: "US President · headline mover",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/16/Official_Presidential_Portrait_of_President_Donald_J._Trump_%282025%29.jpg/330px-Official_Presidential_Portrait_of_President_Donald_J._Trump_%282025%29.jpg",
    sources: [
      newsSource("trump", "Donald Trump", "Donald Trump"),
      xTalk("trump", "Donald Trump"),
      redditTalk("trump", "Donald Trump"),
    ],
  },
  {
    label: "taylor", name: "Taylor Swift", symbol: "TAYLOR", categories: [CAT.music, CAT.people],
    aura: 3550, windowMinutes: 60, summary: "Touring + release-cycle aura",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b1/Taylor_Swift_at_the_2023_MTV_Video_Music_Awards_%283%29.png/330px-Taylor_Swift_at_the_2023_MTV_Video_Music_Awards_%283%29.png",
    sources: [
      newsSource("taylor", "Taylor Swift", "Taylor Swift"),
      xTalk("taylor", "Taylor Swift"),
      redditTalk("taylor", "Taylor Swift"),
    ],
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
  const idle: bigint = await pool.idle();
  const need = BigInt(SEEDS.length + 4) * 1_000n * ONE;
  if (idle < need) {
    const target = need * 2n;
    await (await usdc.mint(deployer.address, target)).wait();
    await (await usdc.approve(deployments.pool, target)).wait();
    await (await pool.deposit(target)).wait();
    console.log(`deposited ${Number(target / ONE).toLocaleString()} mUSDC into the pool`);
  }

  const handles: Record<string, unknown> = { ...(deployments.handles ?? {}) };
  let created = 0;
  let opened = 0;

  for (const s of SEEDS) {
    const id = h(s.label);
    let handleAddress: string = await handleFactory.handleOf(id);

    if (handleAddress === ZERO) {
      if (!(await registry.isRegistered(id))) {
        await (await registry.registerHandle(id, s.windowMinutes)).wait();
      }
      const metadata = JSON.stringify({
        name: s.name,
        symbol: s.symbol,
        photo: s.photo,
        imageFit: s.imageFit ?? "cover",
        categories: s.categories.map(String),
      });
      await (
        await handleFactory.createHandle(
          id,
          deployer.address,
          s.name,
          s.symbol,
          metadata,
          BigInt(s.windowMinutes),
          s.categories.map((c) => BigInt(c)),
        )
      ).wait();
      handleAddress = await handleFactory.handleOf(id);
      created += 1;
    }

    const handle: Contract = await ethers.getContractAt("Handle", handleAddress);
    // The relayer is the aura updater (and the curator fallback): it can write
    // metadata, add sources, push aura and graduate.
    if ((await handle.auraUpdater()).toLowerCase() !== relayer.address.toLowerCase()) {
      await (await handleFactory.setAuraUpdater(id, relayer.address)).wait();
    }
    await (
      await handle.connect(relayer).setMetadata(
        JSON.stringify({
          name: s.name,
          symbol: s.symbol,
          photo: s.photo,
          imageFit: s.imageFit ?? "cover",
          categories: s.categories.map(String),
        }),
      )
    ).wait();

    // --- sources: handle-scoped feeds, each with topic + context -----------------
    // `addSource` skips an identical config on-chain, so this is idempotent.
    let added = 0;
    for (const src of s.sources) {
      await (await handle.connect(relayer).addSource(JSON.stringify({ platform: "rss", ...src }))).wait();
      added += 1;
    }

    await (await handle.connect(relayer).updateAura(BigInt(s.aura), s.summary)).wait();
    await (await handle.connect(relayer).setGraduated(true)).wait();

    // First window: bootstrap ONLY when the engine hasn't opened this slot —
    // otherwise the handle would have two live windows at once.
    const span = BigInt(s.windowMinutes * 60);
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const slotStart = (nowSec / span) * span;
    const alreadyOpen = (await oracleFactory.oracleOf(id, slotStart)) !== ethers.ZeroAddress;
    if (alreadyOpen) {
      console.log(`  · @${s.label.padEnd(9)} sources +${added}, engine already opened slot ${slotStart}`);
    } else {
      const block = await ethers.provider.getBlock("latest");
      const start = BigInt(block ? block.timestamp : Math.floor(Date.now() / 1000));
      const end = start + BigInt(s.windowMinutes * 60);
      try {
        await (
          await market.connect(relayer).openWindow(
            id,
            start,
            end,
            ["YES", "NO"],
            [
              JSON.stringify({ handle: s.label, outcome: 0, name: "YES" }),
              JSON.stringify({ handle: s.label, outcome: 1, name: "NO" }),
            ],
            [5n * 10n ** 17n, 5n * 10n ** 17n],
            JSON.stringify({
              question: `Will @${s.label} aura rise above ${(s.aura / 100).toFixed(2)}?`,
              style: "binary",
              category: s.categories[0],
              strike: s.aura,
              handle: s.label,
            }),
            1_000n * ONE,
          )
        ).wait();
        opened += 1;
        console.log(`  ✓ @${s.label.padEnd(9)} sources +${added}, window ${start} → ${end}`);
      } catch (error) {
        const message = (error as Error).message;
        const alreadyOpenRevert = /window.*(already|open)|AlreadyOpen/i.test(message);
        if (!alreadyOpenRevert) throw error;
        console.log(`  · @${s.label.padEnd(9)} sources +${added}, window already open`);
      }
    }

    handles[s.label] = {
      id,
      contract: handleAddress,
      stake: await handleFactory.stakeOf(id),
      categories: s.categories,
      aura: s.aura,
      graduated: true,
      photo: s.photo,
      windowMinutes: s.windowMinutes,
      sources: s.sources.map((x) => x.outlet),
    };
  }

  deployments.handles = handles;
  writeFileSync("deployments/deployments.json", `${JSON.stringify(deployments, null, 2)}\n`);
  console.log(
    `\nSeeded ${created} new handle(s), opened ${opened} window(s) — total seeded: ${SEEDS.length}.\n` +
      `Each handle carries only its own scoped sources. Wrote deployments/deployments.json\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
