import type { AdapterCredentials, AdapterSample, SourceConfig } from "../../core/domain/source";
import { BaseSource } from ".././base-source";
import { apiGetJson, bucketStart } from ".././http";

/**
 * Instagram adapter — an Instagram Business profile's own metrics via the
 * Instagram Graph API (long-lived token from the connection):
 *   followers — follower count
 *   media     — media count
 * Returns an empty sample without credentials.
 */
export class InstagramConnectAdapter extends BaseSource {
  readonly platform = "instagram";
  readonly weight = 480; // 1-1000 credibility
  readonly kind = "social" as const;
  readonly fetchIntervalMs = 2 * 60_000;
  readonly requiredCredentials = ["instagram:accessToken"] as const;

  readonly metrics = [
    { key: "followers", label: "Followers", unit: "followers", higherIsBetter: true, source: "Instagram Graph API /me?fields=followers_count" },
    { key: "media", label: "Posts", unit: "posts", higherIsBetter: true, source: "Instagram Graph API /me?fields=media_count" },
  ];

  id(config: SourceConfig): string {
    return `instagram-${this.str(config, "username") ?? "unknown"}`;
  }

  label(config: SourceConfig): string {
    return `Instagram — ${this.str(config, "username") ?? "unknown"}`;
  }

  async fetch(
    config: SourceConfig,
    _since: number,
    now: number,
    credentials?: AdapterCredentials,
  ): Promise<AdapterSample> {
    const token = credentials?.accessToken;
    if (!token) return { points: {} };

    try {
      const me = await apiGetJson(
        `https://graph.instagram.com/me?fields=id,username,followers_count,media_count&access_token=${encodeURIComponent(token)}`,
      ) as { followers_count?: number; media_count?: number };
      const t = bucketStart(now);
      return {
        points: {
          followers: [{ timestamp: t, value: me.followers_count ?? 0 }],
          media: [{ timestamp: t, value: me.media_count ?? 0 }],
        },
      };
    } catch {
      return { points: {} };
    }
  }
}