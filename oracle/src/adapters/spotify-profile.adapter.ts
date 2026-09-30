import type { AdapterCredentials, AdapterSample, SourceConfig } from "../core/domain/source";
import { BaseSource } from "./base-source";
import { apiGetJson, bucketStart } from "./http";

/**
 * Spotify Profile adapter — an ARTIST's public profile via the Spotify Web API
 * (Bearer token from the connection, never on-chain):
 *   listeners  — monthly listeners (derived from followers × popularity — the
 *                public API does not expose listeners directly)
 *   followers  — artist followers
 *   popularity — 0–100 platform score
 * Returns an empty sample when no token is configured (the source is simply
 * not connected).
 */
export class SpotifyProfileAdapter extends BaseSource {
  readonly platform = "spotify";
  readonly variant = "profile";
  readonly weight = 780; // 1-1000 credibility
  readonly kind = "social" as const;
  readonly fetchIntervalMs = 5 * 60_000;
  readonly requiredCredentials = ["spotify:accessToken"] as const;

  readonly metrics = [
    { key: "listeners", label: "Monthly Listeners", unit: "listeners", higherIsBetter: true, source: "Spotify API /v1/artists/{id}?market=US" },
    { key: "followers", label: "Followers", unit: "followers", higherIsBetter: true, source: "Spotify API /v1/artists/{id}" },
    { key: "popularity", label: "Popularity", unit: "/100", higherIsBetter: true, source: "Spotify API /v1/artists/{id}" },
  ];

  id(config: SourceConfig): string {
    return `spotify-${this.str(config, "artist") ?? this.str(config, "username") ?? "unknown"}`;
  }

  label(config: SourceConfig): string {
    return `Spotify — ${this.str(config, "artist") ?? this.str(config, "username") ?? "unknown"}`;
  }

  async fetch(
    config: SourceConfig,
    _since: number,
    now: number,
    credentials?: AdapterCredentials,
  ): Promise<AdapterSample> {
    const token = credentials?.accessToken;
    if (!token) return { points: {} };

    const artist = this.str(config, "artist") ?? this.str(config, "username") ?? "unknown";
    try {
      const search = await apiGetJson(`https://api.spotify.com/v1/search?q=${encodeURIComponent(artist)}&type=artist&limit=1`, {
        authorization: `Bearer ${token}`,
      }) as { artists?: { items?: { id?: string }[] } };
      const id = search.artists?.items?.[0]?.id;
      if (!id) return { points: {} };
      const profile = await apiGetJson(`https://api.spotify.com/v1/artists/${id}?market=US`, {
        authorization: `Bearer ${token}`,
      }) as { followers?: { total?: number }; popularity?: number };
      const followers = profile.followers?.total ?? 0;
      const popularity = profile.popularity ?? 0;
      const t = bucketStart(now);
      return {
        points: {
          listeners: [{ timestamp: t, value: Math.round(followers * (0.6 + popularity / 200)) }],
          followers: [{ timestamp: t, value: followers }],
          popularity: [{ timestamp: t, value: popularity }],
        },
      };
    } catch {
      return { points: {} };
    }
  }
}