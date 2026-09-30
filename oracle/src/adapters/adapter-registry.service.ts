import { Injectable } from "@nestjs/common";
import { BaseSource } from "./base-source";
import { SpotifyProfileAdapter } from "./spotify-profile.adapter";
import { SpotifyMeAdapter } from "./spotify-me.adapter";
import { ShopifyAdapter } from "./shopify.adapter";
import { BbcAdapter } from "./bbc.adapter";
import { FoxSportsAdapter } from "./foxsports.adapter";
import { RssAdapter } from "./rss.adapter";
import { InstagramAdapter } from "./instagram.adapter";
import { GitHubAdapter } from "./github.adapter";
import { RedditAdapter } from "./reddit.adapter";
import { YouTubeAdapter } from "./youtube.adapter";
import { HackerNewsAdapter } from "./hackernews.adapter";
import { TwitchAdapter } from "./twitch.adapter";
import { FacebookAdapter } from "./facebook.adapter";
import { LinkedInAdapter } from "./linkedin.adapter";
import type { Source, SourceConfig } from "../core/domain/source";

/**
 * AdapterRegistry — maps a `platform` (plus an optional `variant`) to the
 * BaseSource that extracts that data source through its REAL API. Only
 * platforms with a reachable API are registered (X has no free tier, so it is
 * intentionally absent). Also parses the on-chain Handle's source JSON strings
 * (`{ platform: "spotify", variant: "me", account: "dev" }`) into Sources.
 */
@Injectable()
export class AdapterRegistry {
  private readonly byKey = new Map<string, BaseSource>();

  constructor() {
    const adapters: BaseSource[] = [
      new SpotifyProfileAdapter(),
      new SpotifyMeAdapter(),
      new ShopifyAdapter(),
      new BbcAdapter(),
      new FoxSportsAdapter(),
      new RssAdapter(),
      new InstagramAdapter(),
      new GitHubAdapter(),
      new RedditAdapter(),
      new YouTubeAdapter(),
      new HackerNewsAdapter(),
      new TwitchAdapter(),
      new FacebookAdapter(),
      new LinkedInAdapter(),
    ];
    for (const adapter of adapters) this.byKey.set(adapter.registryKey(), adapter);
  }

  /** The adapter for a (platform, variant) key, or null. */
  get(platform: string, variant?: string): BaseSource | null {
    const key = variant ? `${platform}::${variant}` : platform;
    return this.byKey.get(key) ?? null;
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