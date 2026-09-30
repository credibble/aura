import type { AdapterCredentials, AdapterSample, SourceConfig } from "../core/domain/source";
import { BaseSource } from "./base-source";
import { apiGetJson, bucketStart } from "./http";

/**
 * Reddit adapter — a subreddit's own metrics via the public JSON endpoint
 * (no auth; optional token for higher limits):
 *   subscribers — subscriber count
 *   active      — currently active accounts
 *   posts       — recent post volume
 */
export class RedditAdapter extends BaseSource {
  readonly platform = "reddit";
  readonly weight = 620; // 1-1000 credibility
  readonly kind = "community" as const;
  readonly fetchIntervalMs = 5 * 60_000;
  readonly requiredCredentials = [] as const;

  readonly metrics = [
    { key: "subscribers", label: "Subscribers", unit: "subscribers", higherIsBetter: true, source: "Reddit JSON /r/{sub}/about" },
    { key: "active", label: "Active", unit: "users", higherIsBetter: true, source: "Reddit JSON /r/{sub}/about" },
    { key: "posts", label: "Posts", unit: "posts", higherIsBetter: true, source: "Reddit JSON /r/{sub}/new" },
  ];

  id(config: SourceConfig): string {
    return `reddit-${this.str(config, "subreddit") ?? "unknown"}`;
  }

  label(config: SourceConfig): string {
    return `r/${this.str(config, "subreddit") ?? "unknown"}`;
  }

  async fetch(
    config: SourceConfig,
    _since: number,
    now: number,
    _credentials?: AdapterCredentials,
  ): Promise<AdapterSample> {
    const sub = this.str(config, "subreddit") ?? "unknown";
    const headers = { "user-agent": "aura-oracle/1.0" };

    try {
      const about = await apiGetJson(`https://www.reddit.com/r/${encodeURIComponent(sub)}/about.json`, headers) as {
        data?: { subscribers?: number; active_user_count?: number };
      };
      const newPosts = await apiGetJson(`https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=25`, headers) as {
        data?: { children?: unknown[] };
      };
      const t = bucketStart(now);
      return {
        points: {
          subscribers: [{ timestamp: t, value: about.data?.subscribers ?? 0 }],
          active: [{ timestamp: t, value: about.data?.active_user_count ?? 0 }],
          posts: [{ timestamp: t, value: newPosts.data?.children?.length ?? 0 }],
        },
      };
    } catch {
      return { points: {} };
    }
  }
}