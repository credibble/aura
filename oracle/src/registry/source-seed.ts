import type { CategoryId } from "@aura/contracts";
import type { Source } from "../core/domain/source";

const MIN = 60_000;
const FIVE_MIN = 5 * MIN;

/**
 * The global source universe. Sources are independent of handles — each fetches
 * on its own cadence; handles whitelist which sources may feed them.
 */
export const SOURCES: readonly Source[] = [
  // media — high credibility, 5m
  { id: "bbc", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "BBC News", transport: { type: "rss", feedUrl: "https://feeds.bbci.co.uk/news/rss.xml" } },
  { id: "bbc-sports", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "BBC Sport", transport: { type: "rss", feedUrl: "https://feeds.bbci.co.uk/sport/football/rss.xml" } },
  { id: "reuters", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "Reuters", transport: { type: "rss", feedUrl: "https://feeds.reuters.com/reuters/businessNews" } },
  { id: "bloomberg", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "Bloomberg", transport: { type: "rss", feedUrl: "https://feeds.bloomberg.com/handles/news.rss" } },
  { id: "coindesk", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "CoinDesk", transport: { type: "rss", feedUrl: "https://www.coindesk.com/arc/outboundfeeds/rss/" } },
  { id: "the-block", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "The Block", transport: { type: "rss", feedUrl: "https://www.theblock.co/rss.xml" } },
  { id: "the-verge", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "The Verge", transport: { type: "rss", feedUrl: "https://www.theverge.com/rss/index.xml" } },
  { id: "techcrunch", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "TechCrunch", transport: { type: "rss", feedUrl: "https://techcrunch.com/feed/" } },
  { id: "espn", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "ESPN", transport: { type: "rss", feedUrl: "https://www.espn.com/espn/rss/soccer/news" } },
  { id: "variety", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "Variety", transport: { type: "rss", feedUrl: "https://variety.com/feed/" } },
  { id: "billboard", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "Billboard", transport: { type: "rss", feedUrl: "https://www.billboard.com/feed/" } },
  // cross-domain RSS (verified live) — tech, crypto, EV/space, gaming, music
  { id: "9to5-mac", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "9to5Mac", transport: { type: "rss", feedUrl: "https://9to5mac.com/feed/" } },
  { id: "macrumors", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "MacRumors", transport: { type: "rss", feedUrl: "https://feeds.macrumors.com/MacRumors-All" } },
  { id: "venturebeat-ai", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "VentureBeat AI", transport: { type: "rss", feedUrl: "https://venturebeat.com/category/ai/feed/" } },
  { id: "techcrunch-ai", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "TechCrunch AI", transport: { type: "rss", feedUrl: "https://www.techcrunch.com/category/artificial-intelligence/feed/" } },
  { id: "cointelegraph", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "Cointelegraph", transport: { type: "rss", feedUrl: "https://cointelegraph.com/rss" } },
  { id: "decrypt", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "Decrypt", transport: { type: "rss", feedUrl: "https://decrypt.co/feed" } },
  { id: "electrek", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "Electrek", transport: { type: "rss", feedUrl: "https://electrek.co/feed/" } },
  { id: "teslarati", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "Teslarati", transport: { type: "rss", feedUrl: "https://www.teslarati.com/feed/" } },
  { id: "space-news", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "SpaceNews", transport: { type: "rss", feedUrl: "https://spacenews.com/feed/" } },
  { id: "polygon", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "Polygon", transport: { type: "rss", feedUrl: "https://www.polygon.com/rss/index.xml" } },
  { id: "kotaku", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "Kotaku", transport: { type: "rss", feedUrl: "https://kotaku.com/rss" } },
  { id: "ign", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "IGN", transport: { type: "rss", feedUrl: "https://feeds.feedburner.com/ign/all" } },
  { id: "nme", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "NME", transport: { type: "rss", feedUrl: "https://www.nme.com/feed/" } },
  { id: "rolling-stone", kind: "media", weight: 1.0, fetchIntervalMs: FIVE_MIN, label: "Rolling Stone", transport: { type: "rss", feedUrl: "https://www.rollingstone.com/feed/" } },
  { id: "gdelt-world", kind: "media", weight: 0.9, fetchIntervalMs: FIVE_MIN, label: "GDELT", transport: { type: "gdelt", query: "world" } },
  // community — 5m
  { id: "reddit-cryptocurrency", kind: "community", weight: 0.6, fetchIntervalMs: FIVE_MIN, label: "r/CryptoCurrency", transport: { type: "reddit", subreddit: "CryptoCurrency" } },
  { id: "reddit-bitcoin", kind: "community", weight: 0.6, fetchIntervalMs: FIVE_MIN, label: "r/Bitcoin", transport: { type: "reddit", subreddit: "Bitcoin" } },
  { id: "reddit-soccer", kind: "community", weight: 0.6, fetchIntervalMs: FIVE_MIN, label: "r/soccer", transport: { type: "reddit", subreddit: "soccer" } },
  { id: "reddit-memes", kind: "community", weight: 0.6, fetchIntervalMs: FIVE_MIN, label: "r/memes", transport: { type: "reddit", subreddit: "memes" } },
  { id: "reddit-local-llama", kind: "community", weight: 0.6, fetchIntervalMs: FIVE_MIN, label: "r/LocalLLaMA", transport: { type: "reddit", subreddit: "LocalLLaMA" } },
  { id: "hackernews", kind: "community", weight: 0.6, fetchIntervalMs: FIVE_MIN, label: "Hacker News", transport: { type: "hackernews", query: "technology" } },
  { id: "github-monad", kind: "community", weight: 0.4, fetchIntervalMs: FIVE_MIN, label: "GitHub Monad", transport: { type: "github", query: "monad blockchain" } },
  { id: "github-openai", kind: "community", weight: 0.4, fetchIntervalMs: FIVE_MIN, label: "GitHub OpenAI", transport: { type: "github", query: "openai" } },
  // social — fast, low weight
  { id: "youtube-tech", kind: "social", weight: 0.5, fetchIntervalMs: 5 * MIN, label: "YouTube Tech", transport: { type: "youtube", query: "technology AI" } },
  { id: "youtube-sports", kind: "social", weight: 0.5, fetchIntervalMs: 5 * MIN, label: "YouTube Sports", transport: { type: "youtube", query: "football" } },
  // search
  { id: "wikipedia", kind: "search", weight: 0.5, fetchIntervalMs: 10 * MIN, label: "Wikipedia", transport: { type: "wikipedia", query: "notable" } },
];

/**
 * Category → default source ids.
 */
export const CATEGORY_SOURCES: Readonly<Record<CategoryId, readonly string[]>> = {
  crypto: ["coindesk", "the-block", "bloomberg", "cointelegraph", "decrypt", "gdelt-world", "reddit-cryptocurrency", "reddit-bitcoin", "youtube-tech", "wikipedia"],
  ai: ["the-verge", "techcrunch", "venturebeat-ai", "techcrunch-ai", "gdelt-world", "reddit-local-llama", "hackernews", "github-openai", "youtube-tech", "wikipedia"],
  sports: ["bbc-sports", "espn", "reddit-soccer", "youtube-sports"],
  people: ["bbc", "variety", "wikipedia"],
  brands: ["reuters", "bloomberg", "bbc", "wikipedia"],
  memes: ["reddit-memes", "wikipedia"],
  music: ["billboard", "variety", "nme", "rolling-stone", "youtube-tech", "wikipedia"],
  tech: ["the-verge", "techcrunch", "9to5-mac", "macrumors", "bbc", "hackernews", "github-openai", "youtube-tech", "wikipedia"],
  culture: ["variety", "bbc", "rolling-stone", "wikipedia"],
};

/** Per-handle source additions. */
export const HANDLE_EXTRA: Readonly<Record<string, readonly string[]>> = {
  btc: ["cointelegraph", "decrypt"],
  eth: ["cointelegraph", "decrypt"],
  monad: ["github-monad"],
  sol: ["cointelegraph", "decrypt"],
  chatgpt: ["reddit-local-llama", "venturebeat-ai", "techcrunch-ai"],
  claude: ["reddit-local-llama", "venturebeat-ai", "techcrunch-ai"],
  gemini: ["venturebeat-ai", "techcrunch-ai"],
  grok: ["venturebeat-ai", "techcrunch-ai"],
  arsenal: ["reddit-soccer"],
  realmadrid: ["reddit-soccer"],
  barcelona: ["reddit-soccer"],
  chelsea: ["reddit-soccer"],
  elon: ["electrek", "teslarati", "space-news"],
  taylorswift: ["nme", "rolling-stone"],
  mrbeast: ["youtube-sports"],
  ronaldo: ["reddit-soccer"],
  messi: ["reddit-soccer"],
  tesla: ["electrek", "teslarati"],
  apple: ["9to5-mac", "macrumors"],
  nike: [],
  openai: ["reddit-local-llama", "github-openai", "venturebeat-ai", "techcrunch-ai"],
  doge: ["reddit-cryptocurrency", "cointelegraph", "decrypt"],
  pepe: ["cointelegraph", "decrypt"],
  chillguy: [],
  "67": [],
  drake: ["nme", "rolling-stone"],
  sabrina: ["nme", "rolling-stone"],
  iphone: ["9to5-mac", "macrumors"],
  playstation: ["polygon", "kotaku", "ign"],
  gta6: ["polygon", "kotaku", "ign"],
  squidgame: ["rolling-stone"],
};

export function handleAllowedSources(category: CategoryId, handleId: string): readonly string[] {
  const base = CATEGORY_SOURCES[category];
  const extra = HANDLE_EXTRA[handleId] ?? [];
  return [...base, ...extra];
}

/**
 * Numeric handle category code → the family id used by the rules above.
 * Mirrors the subgraph's `categoryIdOf` (`cat = floor(code / 1e6) % 1000`) so the
 * oracle and the app agree on which family a handle belongs to.
 */
export function categoryFamily(code: number): CategoryId {
  if (!Number.isFinite(code)) return "culture";
  const cat = Math.floor(code / 1_000_000) % 1_000;
  if (cat === 100) return "sports";
  if (cat === 1) return "crypto";
  if (cat === 2) return "ai";
  if (cat === 3) return "people";
  if (cat === 4) return "brands";
  if (cat === 5) return "memes";
  if (cat === 6) return "music";
  if (cat === 7) return "tech";
  return "culture";
}