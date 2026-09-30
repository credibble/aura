import type { AdapterCredentials, AdapterSample, SourceConfig } from "../core/domain/source";
import { BaseSource } from "./base-source";
import { apiGetJson, bucketStart } from "./http";

/**
 * Facebook adapter — a page's own metrics via the Facebook Graph API:
 *   fans   — page fan count
 *   newLikes — likes gained today
 * Returns an empty sample without credentials.
 */
export class FacebookAdapter extends BaseSource {
  readonly platform = "facebook";
  readonly weight = 500; // 1-1000 credibility
  readonly kind = "social" as const;
  readonly fetchIntervalMs = 5 * 60_000;
  readonly requiredCredentials = ["facebook:accessToken"] as const;

  readonly metrics = [
    { key: "fans", label: "Page Likes", unit: "likes", higherIsBetter: true, source: "Facebook Graph API /{page}?fields=fan_count" },
    { key: "newLikes", label: "Likes Today", unit: "likes", higherIsBetter: true, source: "Facebook Graph API /{page}?fields=new_like_count" },
  ];

  id(config: SourceConfig): string {
    return `facebook-${this.str(config, "page") ?? this.str(config, "username") ?? "unknown"}`;
  }

  label(config: SourceConfig): string {
    return `Facebook — ${this.str(config, "page") ?? this.str(config, "username") ?? "unknown"}`;
  }

  async fetch(
    config: SourceConfig,
    _since: number,
    now: number,
    credentials?: AdapterCredentials,
  ): Promise<AdapterSample> {
    const token = credentials?.accessToken;
    if (!token) return { points: {} };

    const page = this.str(config, "page") ?? this.str(config, "username") ?? "me";
    try {
      const res = await apiGetJson(
        `https://graph.facebook.com/v18.0/${encodeURIComponent(page)}?fields=fan_count,new_like_count&access_token=${encodeURIComponent(token)}`,
      ) as { fan_count?: number; new_like_count?: number };
      const t = bucketStart(now);
      return {
        points: {
          fans: [{ timestamp: t, value: res.fan_count ?? 0 }],
          newLikes: [{ timestamp: t, value: res.new_like_count ?? 0 }],
        },
      };
    } catch {
      return { points: {} };
    }
  }
}