import type { AdapterCredentials, AdapterSample, SourceConfig } from "../../core/domain/source";
import { BaseSource } from ".././base-source";
import { apiGetJson, bucketStart } from ".././http";

/**
 * YouTube adapter — a channel's own metrics via the YouTube Data API (free,
 * requires an API key from the connection):
 *   subscribers — subscriber count
 *   views       — total view count
 *   videos      — video count
 */
export class YouTubeChannelAdapter extends BaseSource {
  readonly platform = "youtube";
  readonly weight = 550; // 1-1000 credibility
  readonly kind = "social" as const;
  readonly fetchIntervalMs = 5 * 60_000;
  readonly requiredCredentials = ["youtube:apiKey"] as const;

  readonly metrics = [
    { key: "subscribers", label: "Subscribers", unit: "subscribers", higherIsBetter: true, source: "YouTube Data API /channels?part=statistics" },
    { key: "views", label: "Views", unit: "views", higherIsBetter: true, source: "YouTube Data API /channels?part=statistics" },
    { key: "videos", label: "Videos", unit: "videos", higherIsBetter: true, source: "YouTube Data API /channels?part=statistics" },
  ];

  id(config: SourceConfig): string {
    return `youtube-${this.str(config, "channel") ?? this.str(config, "username") ?? "unknown"}`;
  }

  label(config: SourceConfig): string {
    return `YouTube — ${this.str(config, "channel") ?? this.str(config, "username") ?? "unknown"}`;
  }

  async fetch(
    config: SourceConfig,
    _since: number,
    now: number,
    credentials?: AdapterCredentials,
  ): Promise<AdapterSample> {
    const apiKey = credentials?.apiKey ?? credentials?.accessToken;
    if (!apiKey) return { points: {} };

    const handle = this.str(config, "channel") ?? this.str(config, "username") ?? "unknown";
    try {
      const channel = await apiGetJson(
        `https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle=${encodeURIComponent(handle)}&key=${encodeURIComponent(apiKey)}`,
      ) as { items?: { statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string } }[] };
      const stats = channel.items?.[0]?.statistics;
      const t = bucketStart(now);
      return {
        points: {
          subscribers: [{ timestamp: t, value: Number(stats?.subscriberCount ?? 0) }],
          views: [{ timestamp: t, value: Number(stats?.viewCount ?? 0) }],
          videos: [{ timestamp: t, value: Number(stats?.videoCount ?? 0) }],
        },
      };
    } catch {
      return { points: {} };
    }
  }
}