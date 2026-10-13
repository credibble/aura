import type { SourceConfig } from "../core/domain/source";

/**
 * Platforms whose adapter reads the CONNECTED account's OWN data
 * (`adapters/connections/`). Only these become an on-chain `Handle.sources[]`
 * entry when a handle connects: the other UI platforms (x, youtube, reddit,
 * github, twitch) are app-key adapters reading OTHER people's public data, so a
 * per-handle OAuth connection has nothing to point them at.
 */
export const CONNECTION_SOURCE_PLATFORMS = new Set([
  "spotify",
  "instagram",
  "facebook",
  "linkedin",
  "shopify",
]);

/**
 * Canonical on-chain source config for a handle's connection.
 *
 * `account` is the CREDENTIAL KEY: `SourceFetcher.dispatch` resolves the token
 * with `connections.get(config.platform, config.account)`, so it MUST equal the
 * account the credential was stored under. For Supabase OAuth that is the handle
 * id (the app passes `handle.id` as `account`); for Shopify it is the shop.
 *
 * The platform's own subject field (`username`/`page`) is set to the same value
 * so each adapter's `id()` stays unique across handles — without it, e.g.
 * Instagram's `instagram-${username}` would collapse to `instagram-unknown` for
 * every handle and they would share one registry entry.
 *
 * Returns null for a platform with no per-user adapter (the credential may still
 * be stored, but no source is written).
 */
export function connectionSourceConfig(
  platform: string,
  account: string,
): SourceConfig | null {
  const p = platform.trim().toLowerCase();
  if (!CONNECTION_SOURCE_PLATFORMS.has(p) || !account) return null;
  switch (p) {
    case "spotify":
      // `variant: "me"` pins the adapter to the connected account's own profile
      // (artist mode is selected by an `artist` field, which we never set here).
      return { platform: "spotify", variant: "me", account };
    case "instagram":
      return { platform: "instagram", account, username: account };
    case "facebook":
      return { platform: "facebook", account, page: account };
    case "linkedin":
      return { platform: "linkedin", account, username: account };
    case "shopify":
      return { platform: "shopify", account, shop: account };
    default:
      return null;
  }
}

/** The exact JSON written on-chain for a connection, or null when unsupported. */
export function connectionSourceJson(platform: string, account: string): string | null {
  const config = connectionSourceConfig(platform, account);
  return config ? JSON.stringify(config) : null;
}

/**
 * Does an on-chain source JSON belong to `(platform, account)`? Used to find the
 * index to remove — matching by parsed fields survives a builder change, where
 * an exact-string match would not. Non-connection sources never match.
 */
export function isConnectionSource(
  json: string,
  platform: string,
  account: string,
): boolean {
  const target = connectionSourceConfig(platform, account);
  if (!target) return false;
  const cfg = parseConfig(json);
  return cfg !== null && cfg.platform === target.platform && cfg.account === target.account;
}

/**
 * The connection platform an on-chain source JSON was written for, or null when
 * it is not a connection-adapter source (a seeded RSS feed, an app-key search
 * source, or unparsable). The reconcile sweep uses this to leave every *other*
 * source — and every seeded source — untouched.
 */
export function connectionPlatformOf(json: string): string | null {
  const cfg = parseConfig(json);
  if (cfg === null || typeof cfg.platform !== "string") return null;
  return CONNECTION_SOURCE_PLATFORMS.has(cfg.platform) ? cfg.platform : null;
}

function parseConfig(json: string): SourceConfig | null {
  try {
    const cfg = JSON.parse(json) as SourceConfig;
    return cfg && typeof cfg === "object" ? cfg : null;
  } catch {
    return null;
  }
}
