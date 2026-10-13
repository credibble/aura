import { ethers } from "hardhat";
import { readFileSync, writeFileSync } from "node:fs";
import type { Contract } from "ethers";

/**
 * Seed the demo market — 16 handles, each with SOURCES THAT ARE ABOUT IT.
 *
 *   PRIVATE_KEY=$PK ORACLE_PRIVATE_KEY=$PK npx hardhat run scripts/seed-handles.ts --network monadTestnet
 *
 * SOURCING RULE (the point of this list): a handle's sources must be *scoped to
 * that handle*, never a general outlet desk. "@ronaldo" reads an exact-phrase
 * feed for "Cristiano Ronaldo", not a football section that mostly talks about
 * other players. Every feed below was verified to return real items about its
 * handle, and each carries `topic` (drives the AI's <<MENTION>> flag) and
 * `context` (tells the model what the outlet is and how to read it). Low-volume
 * subjects (brainrot, hackathon) widen the news window to 7d for enough signal.
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
function xTalk(label: string, query: string, minFollowers = 100_000, topic?: string): SourceSeed {
  return {
    platform: "x",
    outlet: `x-${label}`,
    query,
    minFollowers,
    label: `X · ${query}`,
    topic: topic ?? query.split(" ").pop()!.toLowerCase(),
    context: `Posts about ${query} from accounts with ${minFollowers.toLocaleString()}+ followers (or verified). Reach is pre-filtered: score what these credible accounts report or argue, not the volume of replies.`,
  };
}

/** Community chatter about the subject, engagement-floor applied. */
function redditTalk(label: string, query: string, minScore = 50, topic?: string): SourceSeed {
  return {
    platform: "reddit",
    outlet: `reddit-${label}`,
    query,
    minScore,
    label: `Reddit · ${query}`,
    topic: topic ?? query.split(" ").pop()!.toLowerCase(),
    context: `Reddit threads about ${query} with real traction (score ≥ ${minScore}). Community sentiment and eyewitness detail; weigh opinion down, concrete reports up.`,
  };
}

/** Google News exact-phrase feed — one query, about one subject. `window`
 *  widens the recency filter for low-volume subjects (default 1d). */
function gnews(query: string, window = "1d"): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`"${query}" when:${window}`)}&hl=en-US&gl=US&ceid=US:en`;
}

/** Per-handle themed-character config — archetype, palette, emoji fallback
 *  (the `character` key written into the on-chain metadata JSON). */
type CharacterSeed = {
  /** Archetype that frames the handle (athlete, musician, brand, crypto, …). */
  type: string;
  /** For person/group handles; "none" for brands and concepts. */
  gender: "female" | "male" | "neutral" | "none";
  /** A representative emoji — cheap avatar fallback before a Jazzicon. */
  emoji: string;
  /** Palette for card gradients / avatar backdrop (hex strings). */
  colors: { primary: string; secondary: string; accent: string };
};

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

/** Themed-character config per handle — archetype, palette, emoji fallback.
 *  A standalone table so every handle's identity is scannable in one place and
 *  the source listings above stay about sourcing. */
const CHARACTER: Record<string, CharacterSeed> = {
  ronaldo:   { type: "athlete",   gender: "male",    emoji: "⚽", colors: { primary: "#1B5E3F", secondary: "#BF0A30", accent: "#D4AF37" } },
  messi:     { type: "athlete",   gender: "male",    emoji: "⚽", colors: { primary: "#75AADB", secondary: "#FFFFFF", accent: "#C9A227" } },
  btc:       { type: "crypto",    gender: "none",    emoji: "₿",  colors: { primary: "#F7931A", secondary: "#000000", accent: "#FFFFFF" } },
  eth:       { type: "crypto",    gender: "none",    emoji: "Ξ",  colors: { primary: "#627EEA", secondary: "#000000", accent: "#8A92B2" } },
  sol:       { type: "crypto",    gender: "none",    emoji: "◎",  colors: { primary: "#9945FF", secondary: "#14F195", accent: "#000000" } },
  openai:    { type: "ai",        gender: "none",    emoji: "✳",  colors: { primary: "#10A37F", secondary: "#000000", accent: "#FFFFFF" } },
  tesla:     { type: "brand",     gender: "none",    emoji: "🚗", colors: { primary: "#E82127", secondary: "#000000", accent: "#FFFFFF" } },
  elon:      { type: "founder",   gender: "male",    emoji: "🚀", colors: { primary: "#0A1A2F", secondary: "#4A6FA5", accent: "#FFFFFF" } },
  trump:     { type: "politician", gender: "male",   emoji: "🎩", colors: { primary: "#002868", secondary: "#BF0A30", accent: "#FFFFFF" } },
  taylor:    { type: "musician",  gender: "female",  emoji: "🎤", colors: { primary: "#E91E8C", secondary: "#F5C518", accent: "#FFFFFF" } },
  adidas:    { type: "brand",     gender: "none",    emoji: "👟", colors: { primary: "#000000", secondary: "#FFFFFF", accent: "#0071CE" } },
  nike:      { type: "brand",     gender: "none",    emoji: "👟", colors: { primary: "#000000", secondary: "#FFFFFF", accent: "#FA5400" } },
  brainrot:  { type: "meme",      gender: "none",    emoji: "🧠", colors: { primary: "#39FF14", secondary: "#FF00FF", accent: "#00E5FF" } },
  kpop:      { type: "musician",  gender: "neutral", emoji: "💜", colors: { primary: "#FF69B4", secondary: "#9B59B6", accent: "#FFFFFF" } },
  country:   { type: "musician",  gender: "neutral", emoji: "🤠", colors: { primary: "#8B4513", secondary: "#D4AF37", accent: "#F5DEB3" } },
  hackathon: { type: "event",     gender: "none",    emoji: "💻", colors: { primary: "#0077B6", secondary: "#2DC653", accent: "#FFFFFF" } },
};

/** The on-chain metadata JSON for a seed — one shape for create + refresh. */
function seedMetadata(s: Seed): string {
  return JSON.stringify({
    name: s.name,
    symbol: s.symbol,
    photo: s.photo,
    imageFit: s.imageFit ?? "cover",
    categories: s.categories.map(String),
    character: CHARACTER[s.label],
  });
}

/** The handle-scoped source set for a person/brand: one exact-phrase news feed. */
function newsSource(label: string, query: string, what: string, window = "1d", topic?: string): SourceSeed {
  return {
    outlet: `gnews-${label}`,
    feed: gnews(query, window),
    label: `Google News · ${what}`,
    topic: topic ?? query.split(" ").pop()!.toLowerCase(),
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
  {
    label: "adidas", name: "Adidas", symbol: "ADIDAS", categories: [CAT.brands],
    aura: 2650, windowMinutes: 60, imageFit: "contain", summary: "Three-stripes sportswear giant",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1b/Adidas_2022_logo.svg/960px-Adidas_2022_logo.svg.png",
    sources: [
      newsSource("adidas", "Adidas", "Adidas"),
      xTalk("adidas", "Adidas"),
      redditTalk("adidas", "Adidas"),
    ],
  },
  {
    label: "nike", name: "Nike", symbol: "NIKE", categories: [CAT.brands],
    aura: 2900, windowMinutes: 60, imageFit: "contain", summary: "Swoosh · largest sportswear brand",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a6/Logo_NIKE.svg/960px-Logo_NIKE.svg.png",
    sources: [
      newsSource("nike", "Nike", "Nike"),
      xTalk("nike", "Nike"),
      redditTalk("nike", "Nike"),
    ],
  },
  {
    label: "brainrot", name: "Brainrot", symbol: "BRAINROT", categories: [CAT.memes],
    aura: 1400, windowMinutes: 60, summary: "AI-absurdist meme cycle",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/df/Italian_brainrot_characters.png/960px-Italian_brainrot_characters.png",
    sources: [
      // Low-volume subject → widen the news window to 7d for enough signal.
      newsSource("brainrot", "brainrot", "brainrot", "7d"),
      xTalk("brainrot", "brainrot"),
      redditTalk("brainrot", "brainrot", 30),
    ],
  },
  {
    label: "kpop", name: "K-pop", symbol: "KPOP", categories: [CAT.culture, CAT.music],
    aura: 3300, windowMinutes: 60, summary: "Korean pop-culture export engine",
    photo: "https://upload.wikimedia.org/wikipedia/commons/5/59/2023_K-Content_Expo_in_UAE_%28KOCCA%29_K-pop_Concert_%281%29.png",
    sources: [
      newsSource("kpop", "K-pop", "K-pop"),
      xTalk("kpop", "K-pop"),
      redditTalk("kpop", "K-pop", 30),
    ],
  },
  {
    label: "country", name: "Country Music", symbol: "COUNTRY", categories: [CAT.culture, CAT.music],
    aura: 2350, windowMinutes: 60, summary: "Nashville sound · storytelling genre",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/58/Jimmie_Rodgers_in_1931.jpg/960px-Jimmie_Rodgers_in_1931.jpg",
    sources: [
      // topic override: the derived last word of "Country music" is "music",
      // too generic — flag the full phrase as the mention instead.
      newsSource("country", "Country music", "Country music", "1d", "country music"),
      xTalk("country", "Country music", 100_000, "country music"),
      redditTalk("country", "Country music", 30, "country music"),
      {
        // A country-music-ONLY outlet (single-genre focus, not a general desk).
        outlet: "tasteofcountry",
        feed: "https://tasteofcountry.com/feed/",
        label: "Taste of Country",
        topic: "country music",
        context: "A country-music-dedicated site: releases, tours, chart moves, artist news. Single-genre focus, so treat as a primary record for the scene; newsworthiness still depends on how big the story is.",
      },
    ],
  },
  {
    label: "hackathon", name: "Hackathon", symbol: "HACK", categories: [CAT.culture],
    aura: 1150, windowMinutes: 60, summary: "Build-in-public dev event culture",
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9c/Wikimedia_Hackathon_Prague_2019_-_Group_Photo_-_CLK.png/960px-Wikimedia_Hackathon_Prague_2019_-_Group_Photo_-_CLK.png",
    sources: [
      // Low-volume subject → widen the news window to 7d for enough signal.
      newsSource("hackathon", "Hackathon", "Hackathon", "7d"),
      xTalk("hackathon", "Hackathon"),
      redditTalk("hackathon", "Hackathon", 30),
    ],
  },
];

const h = (s: string): string => ethers.encodeBytes32String(s);
const ZERO = "0x0000000000000000000000000000000000000000";

/** Read every source config currently stored on the handle (public array). */
async function onChainSources(handle: Contract): Promise<string[]> {
  const count = Number(await handle.sourcesCount());
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(String(await handle.sources(i)));
  return out;
}

/** The adapter outlet id of a stored source JSON, or null when unparsable. */
function outletOf(raw: string): string | null {
  try {
    const cfg = JSON.parse(raw) as { outlet?: unknown };
    return typeof cfg.outlet === "string" ? cfg.outlet : null;
  } catch {
    return null;
  }
}

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
      const metadata = seedMetadata(s);
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
      await handle.connect(relayer).setMetadata(seedMetadata(s))
    ).wait();

    // --- sources: handle-scoped feeds, each with topic + context -----------------
    // A re-run must never append a second config for an outlet already on the
    // handle. `addSource` only skips an EXACT string match, and the seed's outlet
    // naming has changed over time (`x-lionel-messi` → `x-messi`), so an old row
    // and a new one are different strings for the same subject. Key by outlet:
    // skip when the one stored config already matches, otherwise replace every
    // stale/duplicate copy with the fresh one.
    let added = 0;
    for (const src of s.sources) {
      const next = JSON.stringify({ platform: "rss", ...src });
      const current = await onChainSources(handle);
      const same = current.filter((raw) => outletOf(raw) === src.outlet);
      if (same.length === 1 && same[0] === next) continue;
      // removeSource swaps the last element in, so rescan after each removal.
      for (;;) {
        const now = await onChainSources(handle);
        const idx = now.findIndex((raw) => outletOf(raw) === src.outlet);
        if (idx === -1) break;
        await (await handle.connect(relayer).removeSource(idx)).wait();
      }
      await (await handle.connect(relayer).addSource(next)).wait();
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
