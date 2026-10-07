import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  /** When true the app fails fast if Postgres is unreachable (default in production). */
  DB_REQUIRED: z
    .preprocess((v) => (v === undefined ? false : String(v).toLowerCase() === "true"), z.boolean())
    .default(false),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgresql://aura:aura@localhost:5432/aura"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  ORACLE_PRIVATE_KEY: z.string().optional(),
  /** Handle creation oracle — the HandleFactory OWNER key the backend signs
   *  `createHandle` with for the frontend (factory is `onlyOwner`). Endpoint
   *  answers 503 until BOTH this and HANDLE_FACTORY_ADDRESS are set. */
  HANDLE_OWNER_PRIVATE_KEY: z.string().optional(),
  HANDLE_FACTORY_ADDRESS: z.string().optional(),
  CHAIN_ID: z.coerce.number().int().positive().default(10_143),
  RPC_URL: z.string().url().optional(),
  INDEX_MARKET_ADDRESS: z.string().optional(),
  ORACLE_FACTORY_ADDRESS: z.string().optional(),
  KIMI_API_KEY: z.string().optional(),
  KIMI_MODEL: z.string().default("kimi-k2.6"),
  /** Kimi chat base URL - Moonshot by default (chat completions). */
  KIMI_BASE_URL: z.string().url().default("https://api.moonshot.ai/v1"),
  /** Kimi web search — standalone Web Search API the aura AI calls for live
   *  context (`POST /v1/tools/search`). Search runs on the Kimi platform
   *  while chat stays on KIMI_BASE_URL. */
  MOONSHOT_API_KEY: z.string().optional(),
  MOONSHOT_BASE_URL: z.string().url().default("https://api.moonshot.ai/v1"),
  WEB_SEARCH_LIMIT: z.coerce.number().int().positive().max(20).default(5),
  /** X (Twitter) app credentials. The `api/` search adapter reads OTHER
   *  people's public posts with the APP bearer token (read-only) — an app-level
   *  secret, so it lives here, not in a per-account ConnectionStore row. The
   *  consumer key/secret are recorded for OAuth completeness; search uses the
   *  bearer. Env keys follow `PLATFORM_FIELD` (see SourceFetcher). */
  X_CONSUMER_KEY: z.string().optional(),
  X_CONSUMER_SECRET: z.string().optional(),
  X_BEARER_TOKEN: z.string().optional(),
  /** Wallet JWT auth (EIP-191 signMessage → HS256 token) for mutations. */
  AUTH_JWT_SECRET: z.string().default("dev-secret-change-me"),
  AUTH_JWT_TTL: z.coerce.number().int().positive().default(24 * 60 * 60),
  /** Cloudinary — user post media uploads (auto-compressed). */
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default("aura-posts"),
  /** Envio indexer GraphQL — the oracle's source of truth for on-chain Handles
   *  (no handle seeding in the backend; handles are created on-chain and read
   *  through the indexer, cached in Redis). The frontend reads the indexer
   *  directly too — the backend never mirrors indexer data. */
  INDEXER_URL: z.string().url().default("http://localhost:8080/v1/graphql"),
  INDEXER_CACHE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  /** Outbound webhook — new orderbook fills are POSTed here (order.fill). */
  WEBHOOK_URL: z.string().url().optional(),
  /** Supabase — facilitates OAuth for social connections (Spotify, Instagram,
   *  X, ...). The provider tokens land encrypted (AES-256-GCM) in Postgres —
   *  the only connection store (no Redis). */
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_JWKS_URL: z.string().url().optional(),
  /** Passphrase for AES-256-GCM encryption of stored connection credentials. */
  CONNECTION_ENCRYPTION_KEY: z.string().default("aura-dev-connection-key"),
  /** Shopify app — merchant OAuth for the commerce adapter. */
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  /** Cleanverse — CVI identity verification gates creator handle claiming. */
  CLEANVERSE_URL: z.string().url().optional(),
  CLEANVERSE_API_KEY: z.string().optional(),
  CLEANVERSE_REQUIRED: z
    .preprocess((v) => (v === undefined ? false : String(v).toLowerCase() === "true"), z.boolean())
    .default(false),
  /** Alchemy RPC for the relay + read path. */
  ALCHEMY_API_KEY: z.string().optional(),
  ALCHEMY_RPC_URL: z.string().url().optional(),
  /** Job-oriented oracle core (aura/feed/window schedulers). */
  JOBS_ENABLED: z
    .preprocess((v) => (v === undefined ? true : String(v).toLowerCase() === "true"), z.boolean())
    .default(true),
  MARKET_MAKER_ADDRESS: z.string().optional(),
  /** Redis source cache TTL — the window any department reuses another's fetch. */
  SOURCE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  /** Aura history window N (points fed to the AI). */
  AURA_HISTORY_N: z.coerce.number().int().positive().default(10),
  /** Aura level model — bounded, mean-reverting index (see aura-engine.service.ts).
   *  `L = baseline + deviation`; these tune the deviation band and the baseline. */
  AURA_DEVIATION_MAX: z.coerce.number().positive().default(2_500),
  AURA_REVERSION: z.coerce.number().min(0).max(0.95).default(0.2),
  AURA_BASELINE_ETA: z.coerce.number().min(0).max(1).default(0.01),
  AURA_BASELINE_ANCHOR: z.coerce.number().min(0).max(1).default(0.02),
  /** Window job cadence (ms) — how often the scheduler fans out to every
   *  graduated handle to open/settle its current slot. Keep it far below the
   *  handle window length (windowMinutes) so a slot is never missed. */
  WINDOW_EVERY_MS: z.coerce.number().int().positive().default(5_000),
  /** Feed job cadence (ms) — how often the scheduler fans out to every handle
   *  to draft a digest from new source data. */
  FEED_EVERY_MS: z.coerce.number().int().positive().default(1_200_000),
  /** Economic AI gate — minimum ms between aura scoring calls per handle
   *  (bursts coalesce; 0 = every eligible tick may call). */
  AURA_AI_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  return envSchema.parse(config);
}
