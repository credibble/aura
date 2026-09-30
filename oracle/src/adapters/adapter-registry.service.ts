import { Injectable } from "@nestjs/common";
import { BaseSource } from "./base-source";
// public — no credentials: open feeds and open search APIs.
import { RssFeedAdapter } from "./public/rss-feed.adapter";
import { RedditSearchAdapter } from "./public/reddit-search.adapter";
import { HackerNewsSearchAdapter } from "./public/hackernews-search.adapter";
// api — an APP-LEVEL key/token reading OTHER people's public data.
import { XSearchAdapter } from "./api/x-search.adapter";
import { YouTubeChannelAdapter } from "./api/youtube-channel.adapter";
import { GitHubProfileAdapter } from "./api/github-profile.adapter";
import { TwitchChannelAdapter } from "./api/twitch-channel.adapter";
// connections — PER-USER OAuth, the connected account's own data.
import { SpotifyConnectAdapter } from "./connections/spotify-connect.adapter";
import { InstagramConnectAdapter } from "./connections/instagram-connect.adapter";
import { FacebookConnectAdapter } from "./connections/facebook-connect.adapter";
import { LinkedInConnectAdapter } from "./connections/linkedin-connect.adapter";
import { ShopifyConnectAdapter } from "./connections/shopify-connect.adapter";
import type { Source, SourceConfig } from "../core/domain/source";

/**
 * AdapterRegistry — maps a `platform` (plus an optional `variant`) to the
 * BaseSource that extracts that data source through its REAL API, then parses
 * the on-chain Handle's source JSON strings into Sources.
 *
 * NAMING: `<Platform><Purpose>Adapter`.
 *   …SearchAdapter     open/public search (no credentials or an API key)
 *   …Channel/Profile…  app-level key reading someone else's public data (`api/`)
 *   …ConnectAdapter    the CONNECTED account's own data via OAuth (`connections/`)
 * A `<Platform>ConnectAdapter` is never the same thing as a `<Platform>SearchAdapter`
 * — different credential, different subject (you vs. the world).
 *
 * The `platform` string on each adapter is the key ON-CHAIN source configs use;
 * folder and class names are internal and may change freely.
 */
@Injectable()
export class AdapterRegistry {
  private readonly byKey = new Map<string, BaseSource>();

  constructor() {
    // Grouped by credential type, mirroring the folders.
    const adapters: BaseSource[] = [
      // public
      new RssFeedAdapter(),
      new RedditSearchAdapter(),
      new HackerNewsSearchAdapter(),
      // api (app key → public data about anyone)
      new XSearchAdapter(),
      new YouTubeChannelAdapter(),
      new GitHubProfileAdapter(),
      new TwitchChannelAdapter(),
      // connections (per-user OAuth → the connected account's own data)
      new SpotifyConnectAdapter(),
      new InstagramConnectAdapter(),
      new FacebookConnectAdapter(),
      new LinkedInConnectAdapter(),
      new ShopifyConnectAdapter(),
    ];
    for (const adapter of adapters) this.byKey.set(adapter.registryKey(), adapter);
  }

  /** The adapter for a (platform, variant) key, or null. */
  get(platform: string, variant?: string): BaseSource | null {
    const key = variant ? `${platform}::${variant}` : platform;
    // An adapter may serve SEVERAL variants of one platform under a single
    // registration (Spotify: artist profile + the connected account), so a
    // config that names a variant falls back to the platform's adapter.
    return this.byKey.get(key) ?? this.byKey.get(platform) ?? null;
  }

  /** Resolve by a config object. */
  resolve(config: SourceConfig): BaseSource | null {
    const variant = typeof config.variant === "string" ? config.variant : undefined;
    return this.get(config.platform, variant);
  }

  /** Parse a Handle source JSON string → config (each adapter reads its own fields). */
  parseConfig(json: string): SourceConfig | null {
    try {
      const cfg = JSON.parse(json) as SourceConfig;
      if (typeof cfg !== "object" || cfg === null || typeof cfg.platform !== "string") return null;
      return cfg;
    } catch {
      return null;
    }
  }

  /** Build a runtime Source for a config, or null if the platform is unknown. */
  buildSource(config: SourceConfig): Source | null {
    const adapter = this.resolve(config);
    if (!adapter) return null;
    return adapter.toSource(config);
  }

  /** Parse + build a source from an on-chain Handle source JSON string. */
  buildSourceFromJson(json: string): Source | null {
    const config = this.parseConfig(json);
    return config ? this.buildSource(config) : null;
  }

  /** Build Sources from on-chain Handle source JSON strings (invalid ones skip). */
  buildFromJsonStrings(jsons: readonly string[]): Source[] {
    const out: Source[] = [];
    for (const json of jsons) {
      const cfg = this.parseConfig(json);
      if (cfg) {
        const s = this.buildSource(cfg);
        if (s) out.push(s);
      }
    }
    return out;
  }

  /** Every registered adapter, for seeding/health. */
  all(): BaseSource[] {
    return [...this.byKey.values()];
  }
}