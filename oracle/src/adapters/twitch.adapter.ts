import type { AdapterCredentials, AdapterSample, SourceConfig } from "../core/domain/source";
import { BaseSource } from "./base-source";
import { apiGetJson, bucketStart } from "./http";

/**
 * Twitch adapter — a streamer's own metrics via the Twitch Helix API (free,
 * needs a client-id + app access token from the connection):
 *   followers — follower count
 *   viewers   — average live viewers (aggregate of current stream view count)
 */
export class TwitchAdapter extends BaseSource {
  readonly platform = "twitch";
  readonly weight = 520; // 1-1000 credibility
  readonly kind = "social" as const;
  readonly fetchIntervalMs = 5 * 60_000;
  readonly requiredCredentials = ["twitch:clientId", "twitch:token"] as const;

  readonly metrics = [
    { key: "followers", label: "Followers", unit: "followers", higherIsBetter: true, source: "Twitch Helix /users/follows" },
    { key: "viewers", label: "Viewers", unit: "viewers", higherIsBetter: true, source: "Twitch Helix /streams" },
  ];

  id(config: SourceConfig): string {
    return `twitch-${this.str(config, "login") ?? this.str(config, "username") ?? "unknown"}`;
  }

  label(config: SourceConfig): string {
    return `Twitch — ${this.str(config, "login") ?? this.str(config, "username") ?? "unknown"}`;
  }

  async fetch(
    config: SourceConfig,
    _since: number,
    now: number,
    credentials?: AdapterCredentials,
  ): Promise<AdapterSample> {
    const clientId = credentials?.secrets?.clientId ?? credentials?.secrets?.client_id;
    const token = credentials?.accessToken ?? credentials?.apiKey;
    if (!clientId || !token) return { points: {} };

    const login = this.str(config, "login") ?? this.str(config, "username") ?? "unknown";
    try {
      const headers = { "client-id": clientId, authorization: `Bearer ${token}` };
      const user = await apiGetJson(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, headers) as {
        data?: { id?: string }[];
      };
      const id = user.data?.[0]?.id;
      if (!id) return { points: {} };

      const follows = await apiGetJson(`https://api.twitch.tv/helix/users/follows?to_id=${id}`, headers) as { total?: number };
      const streams = await apiGetJson(`https://api.twitch.tv/helix/streams?user_id=${id}`, headers) as {
        data?: { viewer_count?: number }[];
      };
      const t = bucketStart(now);
      return {
        points: {
          followers: [{ timestamp: t, value: follows.total ?? 0 }],
          viewers: [{ timestamp: t, value: streams.data?.reduce((acc, s) => acc + (s.viewer_count ?? 0), 0) ?? 0 }],
        },
      };
    } catch {
      return { points: {} };
    }
  }
}