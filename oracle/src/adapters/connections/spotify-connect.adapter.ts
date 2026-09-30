import type { AdapterCredentials, AdapterSample, MetricDef, SourceConfig } from "../../core/domain/source";
import type { RawDatum } from "../../core/domain/source-item";
import { BaseSource } from "../base-source";
import { apiGetJson, bucketStart } from "../http";

/**
 * Spotify adapter — BOTH halves of the platform in one code path, because they
 * are the same protocol behind the same token:
 *
 *   artist mode  (config has `artist`/`username`): search → artist → followers,
 *                popularity and the artist's TOP TRACKS as feed items;
 *   me mode      (no artist in the config):        the CONNECTED account's own
 *                profile via /v1/me → its follower count.
 *
 * The old SpotifyProfile/SpotifyMe split was two classes, two registry keys and
 * two tests for one API. Mode is a property of the source config, not of a class.
 *
 * There is deliberately NO "monthly listeners" metric: the public API does not
 * expose it, and deriving one from followers × popularity invented a signal that
 * moved the aura. Returns an empty sample when no token is configured.
 */
export class SpotifyConnectAdapter extends BaseSource {
  readonly platform = "spotify";
  readonly weight = 780; // 1-1000 credibility (artist profile ranks above "me")
  readonly kind = "social" as const;
  readonly fetchIntervalMs = 5 * 60_000;
  readonly requiredCredentials = ["spotify:accessToken"] as const;

  readonly metrics: MetricDef[] = [
    { key: "followers", label: "Followers", unit: "followers", higherIsBetter: true, source: "Spotify API" },
    { key: "popularity", label: "Popularity", unit: "/100", higherIsBetter: true, source: "Spotify API /v1/artists/{id}" },
  ];

  /** The subject of the source: an artist name, else the connected account. */
  private subject(config: SourceConfig): string {
    return this.str(config, "artist") ?? this.str(config, "account") ?? this.str(config, "username") ?? "unknown";
  }

  /** `artist` in the config (or an explicit variant) selects artist mode. */
  private isArtistMode(config: SourceConfig): boolean {
    const variant = this.str(config, "variant");
    if (variant === "profile") return true;
    if (variant === "me") return false;
    return Boolean(this.str(config, "artist"));
  }

  id(config: SourceConfig): string {
    return this.isArtistMode(config) ? `spotify-${this.subject(config)}` : `spotify-me-${this.subject(config)}`;
  }

  label(config: SourceConfig): string {
    return this.isArtistMode(config)
      ? `Spotify — ${this.subject(config)}`
      : `Spotify Me — ${this.subject(config)}`;
  }

  async fetch(
    config: SourceConfig,
    _since: number,
    now: number,
    credentials?: AdapterCredentials,
  ): Promise<AdapterSample> {
    const token = credentials?.accessToken;
    if (!token) return { points: {} };
    const t = bucketStart(now);

    // --- me mode: the connected account's own profile -------------------------
    if (!this.isArtistMode(config)) {
      try {
        const me = (await apiGetJson("https://api.spotify.com/v1/me", {
          authorization: `Bearer ${token}`,
        })) as { followers?: { total?: number } };
        return { points: { followers: [{ timestamp: t, value: me.followers?.total ?? 0 }] } };
      } catch {
        return { points: {} };
      }
    }

    // --- artist mode: search → profile → top tracks ---------------------------
    const artist = this.subject(config);
    try {
      const search = (await apiGetJson(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(artist)}&type=artist&limit=1`,
        { authorization: `Bearer ${token}` },
      )) as { artists?: { items?: { id?: string }[] } };
      const id = search.artists?.items?.[0]?.id;
      if (!id) return { points: {} };

      const profile = (await apiGetJson(`https://api.spotify.com/v1/artists/${id}?market=US`, {
        authorization: `Bearer ${token}`,
      })) as { followers?: { total?: number }; popularity?: number };
      const top = (await apiGetJson(`https://api.spotify.com/v1/artists/${id}/top-tracks?market=US`, {
        authorization: `Bearer ${token}`,
      }).catch(() => ({ tracks: [] }))) as {
        tracks?: {
          id?: string;
          name?: string;
          popularity?: number;
          external_urls?: { spotify?: string };
          album?: { name?: string };
        }[];
      };

      const followers = profile.followers?.total ?? 0;
      const popularity = profile.popularity ?? 0;

      return {
        points: {
          followers: [{ timestamp: t, value: followers }],
          popularity: [{ timestamp: t, value: popularity }],
        },
        items: (top.tracks ?? [])
          .filter((tr) => tr.name)
          .slice(0, 10)
          .map((tr): RawDatum => ({
            id: tr.id,
            sourceName: this.label(config),
            text: `"${tr.name}" by ${artist}${tr.album?.name ? ` — ${tr.album.name}` : ""}`,
            url: tr.external_urls?.spotify,
            author: artist,
            publishedAt: now,
            engagement: tr.popularity ?? 0,
            stats: { popularity: tr.popularity ?? 0 },
          })),
      };
    } catch {
      return { points: {} };
    }
  }
}
