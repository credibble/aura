import type { AdapterCredentials } from "../domain/source";

/**
 * Connection store — where adapters get their platform credentials (OAuth
 * tokens / API keys / secrets). Credentials are NEVER on-chain; they are
 * registered by the protocol operator (OAuth flow or manual API key),
 * persisted AES-256-GCM encrypted in Postgres (the only connection store —
 * no Redis), and resolved by (platform, account) at fetch time.
 */
export interface IConnectionStore {
  /** Credentials for a platform account, or null if none is connected. */
  get(platform: string, account?: string): Promise<AdapterCredentials | null>;

  /** Register/update a connection (OAuth callback or manual key entry). */
  set(platform: string, account: string, credentials: AdapterCredentials): Promise<void>;

  /** Revoke a connection. */
  remove(platform: string, account: string): Promise<void>;

  /** Every connected account for a platform. */
  accounts(platform: string): Promise<{ account: string; accessToken?: string; apiKey?: string }[]>;
}