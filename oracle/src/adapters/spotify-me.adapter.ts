import type { AdapterCredentials, AdapterSample, SourceConfig } from "../core/domain/source";
import { BaseSource } from "./base-source";
import { apiGetJson, bucketStart } from "./http";

/**
 * Spotify Me adapter — the CONNECTED user's own profile via GET /v1/me (OAuth
 * Bearer token from the connection). Extracts:
 *   followers — the user's follower count
 * Returns an empty sample when no token is configured.
 */
export class SpotifyMeAdapter extends BaseSource {
  readonly platform = "spotify";
  readonly variant = "me";
  readonly weight = 420; // 1-1000 credibility
  readonly kind = "social" as const;
  readonly fetchIntervalMs = 5 * 60_000;
  readonly requiredCredentials = ["spotify:accessToken"] as const;

  readonly metrics = [
    { key: "followers", label: "Followers", unit: "followers", higherIsBetter: true, source: "Spotify API /v1/me" },
  ];

  id(config: SourceConfig): string {
    return `spotify-me-${this.str(config, "account") ?? this.str(config, "username") ?? "unknown"}`;
  }

  label(config: SourceConfig): string {
    return `Spotify Me — ${this.str(config, "account") ?? this.str(config, "username") ?? "unknown"}`;
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
      const me = await apiGetJson("https://api.spotify.com/v1/me", {
        authorization: `Bearer ${token}`,
      }) as { followers?: { total?: number } };
      const t = bucketStart(now);
      return { points: { followers: [{ timestamp: t, value: me.followers?.total ?? 0 }] } };
    } catch {
      return { points: {} };
    }
  }
}