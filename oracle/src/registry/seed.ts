import type { CategoryId, HandleSpec } from "@aura/contracts";
import type { HandleConfig } from "../core/domain/handle";
import { handleAllowedSources } from "./source-seed";

/**
 * The Aura handle (handle) universe. Mirror of the frontend seed universe
 * (`o2-echo-canvas/src/lib/aura-data.ts`) corrected for the real data model:
 * baselines are 0-100 index seeds, and each handle whitelists the sources that
 * may feed it (see `source-seed.ts`) — sources themselves are independent.
 */

const WINDOWS_MIN = [15, 30, 60, 120, 240, 480, 1440] as const;

interface EntitySeed extends Omit<HandleSpec, "baseline" | "windowMinutes" | "kind"> {}

/** Frontend SEEDS order — window assignment must match `WINDOWS[i % 7]`. */
const ENTITIES: readonly EntitySeed[] = [
  { id: "btc", symbol: "BTC", name: "Bitcoin", category: "crypto", color: "#f7931a", volatility: 0.012, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/330px-Bitcoin.svg.png", imageFit: "contain" },
  { id: "eth", symbol: "ETH", name: "Ethereum", category: "crypto", color: "#627eea", volatility: 0.011, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Eth-diamond-%28color%29.svg/330px-Eth-diamond-%28color%29.svg.png", imageFit: "contain" },
  { id: "monad", symbol: "MONAD", name: "Monad", category: "crypto", color: "#7c3aed", volatility: 0.035, image: "https://www.google.com/s2/favicons?domain=monad.xyz&sz=128", imageFit: "contain" },
  { id: "sol", symbol: "SOL", name: "Solana", category: "crypto", color: "#14f195", volatility: 0.016, image: "https://upload.wikimedia.org/wikipedia/en/b/b9/Solana_logo.png", imageFit: "contain" },
  { id: "chatgpt", symbol: "GPT", name: "ChatGPT", category: "ai", color: "#10a37f", volatility: 0.018, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/OpenAI_logo_2025_%28symbol%29.svg/330px-OpenAI_logo_2025_%28symbol%29.svg.png", imageFit: "contain" },
  { id: "claude", symbol: "CLD", name: "Claude", category: "ai", color: "#d97706", volatility: 0.02, image: "https://upload.wikimedia.org/wikipedia/commons/8/8a/Claude_AI_logo.svg", imageFit: "contain" },
  { id: "gemini", symbol: "GEM", name: "Gemini", category: "ai", color: "#4285f4", volatility: 0.019, image: "https://upload.wikimedia.org/wikipedia/commons/8/8a/Google_Gemini_logo.svg", imageFit: "contain" },
  { id: "grok", symbol: "GRK", name: "Grok", category: "ai", color: "#0ea5e9", volatility: 0.026, image: "https://upload.wikimedia.org/wikipedia/commons/8/8b/Grok_logo_%282023-2025%29.svg", imageFit: "contain" },
  { id: "arsenal", symbol: "ARS", name: "Arsenal", category: "sports", color: "#ef0107", volatility: 0.03, image: "https://upload.wikimedia.org/wikipedia/en/thumb/5/53/Arsenal_FC.svg/330px-Arsenal_FC.svg.png", imageFit: "contain" },
  { id: "realmadrid", symbol: "RMA", name: "Real Madrid", category: "sports", color: "#febe10", volatility: 0.022, image: "https://upload.wikimedia.org/wikipedia/en/thumb/5/56/Real_Madrid_CF.svg/330px-Real_Madrid_CF.svg.png", imageFit: "contain" },
  { id: "barcelona", symbol: "FCB", name: "Barcelona", category: "sports", color: "#a50044", volatility: 0.025, image: "https://upload.wikimedia.org/wikipedia/en/thumb/4/47/FC_Barcelona_%28crest%29.svg/330px-FC_Barcelona_%28crest%29.svg.png", imageFit: "contain" },
  { id: "chelsea", symbol: "CHE", name: "Chelsea", category: "sports", color: "#034694", volatility: 0.028, image: "https://upload.wikimedia.org/wikipedia/en/thumb/c/cc/Chelsea_FC.svg/330px-Chelsea_FC.svg.png", imageFit: "contain" },
  { id: "elon", symbol: "ELON", name: "Elon Musk", category: "people", color: "#0ea5e9", volatility: 0.02, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Elon_Musk_-_54820081119_%28cropped%29.jpg/330px-Elon_Musk_-_54820081119_%28cropped%29.jpg" },
  { id: "taylorswift", symbol: "TSW", name: "Taylor Swift", category: "people", color: "#ec4899", volatility: 0.018, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Taylor_Swift_at_the_2023_MTV_Video_Music_Awards_%283%29.png/330px-Taylor_Swift_at_the_2023_MTV_Video_Music_Awards_%283%29.png" },
  { id: "mrbeast", symbol: "BEA", name: "MrBeast", category: "people", color: "#22c55e", volatility: 0.024, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/MrBeast_in_2026_%28cropped_4%29.png/330px-MrBeast_in_2026_%28cropped_4%29.png" },
  { id: "ronaldo", symbol: "CR7", name: "Cristiano Ronaldo", category: "people", color: "#f43f5e", volatility: 0.02, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg/330px-Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg" },
  { id: "messi", symbol: "MESSI", name: "Lionel Messi", category: "people", color: "#6cabdd", volatility: 0.023, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Leo_Messi_Argentina_v_Egypt_7_July_2026-1.jpg/330px-Leo_Messi_Argentina_v_Egypt_7_July_2026-1.jpg" },
  { id: "tesla", symbol: "TSLA", name: "Tesla", category: "brands", color: "#e82127", volatility: 0.02, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Tesla_Motors.svg/330px-Tesla_Motors.svg.png", imageFit: "contain" },
  { id: "apple", symbol: "AAPL", name: "Apple", category: "brands", color: "#a3aaae", volatility: 0.014, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Apple_logo_black.svg/330px-Apple_logo_black.svg.png", imageFit: "contain" },
  { id: "nike", symbol: "NKE", name: "Nike", category: "brands", color: "#111827", volatility: 0.018, image: "https://upload.wikimedia.org/wikipedia/commons/a/a6/Logo_NIKE.svg", imageFit: "contain" },
  { id: "openai", symbol: "OAI", name: "OpenAI", category: "brands", color: "#34d399", volatility: 0.024, image: "https://upload.wikimedia.org/wikipedia/commons/a/a0/OpenAI_wordmark_2017.svg", imageFit: "contain" },
  { id: "doge", symbol: "DOGE", name: "Dogecoin", category: "memes", color: "#c2a633", volatility: 0.03, image: "https://upload.wikimedia.org/wikipedia/en/d/d0/Dogecoin_Logo.png", imageFit: "contain" },
  { id: "pepe", symbol: "PEPE", name: "Pepe", category: "memes", color: "#4ade80", volatility: 0.034, image: "https://upload.wikimedia.org/wikipedia/en/6/63/Feels_good_man.jpg" },
  { id: "chillguy", symbol: "CHILL", name: "Chill Guy", category: "memes", color: "#94a3b8", volatility: 0.038, image: "https://upload.wikimedia.org/wikipedia/en/c/c7/Chill_guy_original_artwork.jpg" },
  { id: "67", symbol: "67", name: "6 7", category: "memes", color: "#8b5cf6", volatility: 0.041 },
  { id: "drake", symbol: "DRK", name: "Drake", category: "music", color: "#38bdf8", volatility: 0.022, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Drake_at_The_Carter_Effect_2017_%2836818935200%29_%28cropped%29.jpg/330px-Drake_at_The_Carter_Effect_2017_%2836818935200%29_%28cropped%29.jpg" },
  { id: "sabrina", symbol: "SBR", name: "Sabrina Carpenter", category: "music", color: "#fbbf24", volatility: 0.026, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Sabrina_Carpenter_-_O2_Arena_2025_-_086_%28cropped_2%29.jpg/330px-Sabrina_Carpenter_-_O2_Arena_2025_-_086_%28cropped_2%29.jpg" },
  { id: "iphone", symbol: "IPH", name: "iPhone 17", category: "tech", color: "#6366f1", volatility: 0.02, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/IPhone_17_Vector.svg/330px-IPhone_17_Vector.svg.png", imageFit: "contain" },
  { id: "playstation", symbol: "PS5", name: "PlayStation 5", category: "tech", color: "#3b82f6", volatility: 0.021, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/Black_and_white_Playstation_5_base_edition_with_controller.png/330px-Black_and_white_Playstation_5_base_edition_with_controller.png" },
  { id: "gta6", symbol: "GTA", name: "GTA VI", category: "tech", color: "#22d3ee", volatility: 0.03, image: "https://upload.wikimedia.org/wikipedia/en/4/46/Grand_Theft_Auto_VI.png", imageFit: "contain" },
  { id: "squidgame", symbol: "SQD", name: "Squid Game S3", category: "culture", color: "#ef4444", volatility: 0.028, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Squid_Game_2021_vector_logo_english.svg/330px-Squid_Game_2021_vector_logo_english.svg.png", imageFit: "contain" },
];

/** Category handles — the grouped (3+ outcome) handles. Windows match frontend SPECS. */
const CATEGORIES: readonly { id: CategoryId; name: string; symbol: string; color: string; windowMinutes: number }[] = [
  { id: "people", name: "People", symbol: "PPL", color: "#8b5cf6", windowMinutes: 60 },
  { id: "crypto", name: "Crypto", symbol: "CRY", color: "#f7931a", windowMinutes: 30 },
  { id: "ai", name: "AI", symbol: "AI", color: "#10b981", windowMinutes: 240 },
  { id: "memes", name: "Memes", symbol: "MEM", color: "#ec4899", windowMinutes: 15 },
  { id: "sports", name: "Football", symbol: "FB", color: "#0ea5e9", windowMinutes: 120 },
  { id: "brands", name: "Brands", symbol: "BRD", color: "#f43f5e", windowMinutes: 480 },
  { id: "music", name: "Music", symbol: "MUS", color: "#f472b6", windowMinutes: 60 },
  { id: "culture", name: "Culture", symbol: "CUL", color: "#f97316", windowMinutes: 1440 },
  { id: "tech", name: "Tech", symbol: "TCH", color: "#06b6d4", windowMinutes: 240 },
];

function buildHandle(
  kind: "entity" | "category",
  seed: { id: string; name: string; category: CategoryId },
  windowMinutes: number,
  volatility: number,
  color: string,
  image?: string,
  imageFit?: "cover" | "contain",
): HandleConfig {
  return {
    id: seed.id,
    symbol: seed.id.toUpperCase().slice(0, 4),
    name: seed.name,
    category: seed.category,
    kind,
    windowMinutes,
    color,
    image,
    imageFit,
    baseline: 50,
    volatility,
    allowedSources: handleAllowedSources(seed.category, seed.id),
  };
}

/** The full universe: 31 entity handles + 9 category handles. */
export function buildHandleConfigs(): HandleConfig[] {
  const entityConfigs = ENTITIES.map((e, i) =>
    buildHandle("entity", e, WINDOWS_MIN[i % WINDOWS_MIN.length]!, e.volatility, e.color, e.image, e.imageFit),
  );
  const categoryConfigs = CATEGORIES.map((c) =>
    buildHandle("category", { id: c.id, name: c.name, category: c.id }, c.windowMinutes, 0.02, c.color),
  );
  return [...entityConfigs, ...categoryConfigs];
}

/**
 * Presentation metadata DEFAULTS for a handle id — the on-chain Handle only
 * carries identity (name/symbol/windowMinutes/sources), so the oracle merges
 * display fields (category, kind, color, image, volatility) from this table.
 * This is NOT seeding: handles still come from the subgraph; this only fills
 * cosmetic/behavioral fields the chain does not store.
 */
export function handleDefaultMeta(id: string): {
  category?: string;
  kind?: "entity" | "category";
  color?: string;
  image?: string;
  imageFit?: "cover" | "contain";
  volatility?: number;
  baseline?: number;
  windowMinutes?: number;
  symbol?: string;
  name?: string;
} {
  const entity = ENTITIES.find((e) => e.id === id);
  if (entity) {
    const i = ENTITIES.indexOf(entity);
    return {
      category: entity.category,
      kind: "entity",
      color: entity.color,
      image: entity.image,
      imageFit: entity.imageFit,
      volatility: entity.volatility,
      baseline: 50,
      windowMinutes: WINDOWS_MIN[i % WINDOWS_MIN.length],
      symbol: id.toUpperCase().slice(0, 4),
      name: entity.name,
    };
  }
  const category = CATEGORIES.find((c) => c.id === id);
  if (category) {
    return {
      category: category.id,
      kind: "category",
      color: category.color,
      volatility: 0.02,
      baseline: 50,
      windowMinutes: category.windowMinutes,
      symbol: category.symbol,
      name: category.name,
    };
  }
  return {};
}