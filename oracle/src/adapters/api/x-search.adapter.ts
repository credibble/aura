import type { AdapterCredentials, AdapterSample, MetricDef, SourceConfig } from "../../core/domain/source";
import type { RawDatum } from "../../core/domain/source-item";
import { BaseSource } from ".././base-source";
import { apiGetJson, bucketStart } from ".././http";

/** One tweet + its author, as X's v2 API returns them. */
type XTweet = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  public_metrics?: {
    retweet_count?: number;
    reply_count?: number;
    like_count?: number;
    quote_count?: number;
    impression_count?: number;
  };
  attachments?: { media_keys?: string[] };
};
type XUser = {
  id: string;
  username?: string;
  name?: string;
  verified?: boolean;
  public_metrics?: { followers_count?: number; following_count?: number; tweet_count?: number };
};
type XMedia = { media_key: string; type?: string; url?: string; preview_image_url?: string };
type XResponse = {
  data?: XTweet[];
  includes?: { users?: XUser[]; media?: XMedia[] };
  meta?: { result_count?: number };
  errors?: { detail?: string; title?: string }[];
};

const API = "https://api.x.com/2";

/**
 * X (Twitter) adapter — what prestigious accounts are saying about a subject.
 *
 * The point is SIGNAL, not volume: a subject's aura should move on what credible
 * accounts say, not on a thousand 100-follower accounts quote-tweeting a name.
 * So every tweet is filtered by its AUTHOR:
 *
 *   - `minFollowers` (default 100_000): the author's follower count, straight
 *     from the endpoint's `user.fields=public_metrics`;
 *   - a blue-check (`verified`) author always qualifies.
 *
 * Engagement is taken from the endpoint too — `tweet.fields=public_metrics`
 * gives likes, replies, reposts, quotes and impressions — so the sample carries
 * both the metric series (posts / likes / views) and per-item stats for the feed
 * card. Requires an X bearer token (`x:bearerToken`); without it the adapter
 * yields nothing rather than inventing data.
 */
export class XSearchAdapter extends BaseSource {
  readonly platform = "x";
  readonly variant = "search";
  readonly weight = 720; // 1-1000 credibility — platform chatter, ranked by author
  readonly kind = "social" as const;
  readonly fetchIntervalMs = 5 * 60_000;
  readonly requiredCredentials = ["x:bearerToken"] as const;

  readonly metrics: MetricDef[] = [
    { key: "posts", label: "Posts", unit: "posts", higherIsBetter: true, source: "X recent search" },
    { key: "likes", label: "Likes", unit: "likes", higherIsBetter: true, source: "X recent search" },
    { key: "views", label: "Views", unit: "views", higherIsBetter: true, source: "X recent search" },
    { key: "authors", label: "Authors", unit: "accounts", higherIsBetter: true, source: "X recent search" },
  ];

  id(config: SourceConfig): string {
    return `x-${slug(this.query(config))}`;
  }

  label(config: SourceConfig): string {
    return this.str(config, "label") ?? `X · ${this.query(config)}`;
  }

  private query(config: SourceConfig): string {
    return this.str(config, "query") ?? this.str(config, "topic") ?? "aura";
  }

  async fetch(
    config: SourceConfig,
    since: number,
    now: number,
    credentials?: AdapterCredentials,
  ): Promise<AdapterSample> {
    const token = bearer(credentials);
    // No token → no X data. Never synthesize a series here: the AI would be
    // scoring made-up numbers.
    if (!token) return { points: {} };

    const minFollowers = this.num(config, "minFollowers") ?? 100_000;
    const max = Math.min(100, Math.max(10, this.num(config, "limit") ?? 50));
    const query = `${this.query(config)} -is:retweet lang:en`;

    const params = new URLSearchParams({
      query,
      max_results: String(max),
      "tweet.fields": "created_at,public_metrics,lang,author_id,attachments",
      expansions: "author_id,attachments.media_keys",
      "user.fields": "username,name,verified,public_metrics",
      "media.fields": "type,url,preview_image_url",
    });

    try {
      const res = (await apiGetJson(`${API}/tweets/search/recent?${params}`, {
        authorization: `Bearer ${token}`,
        "user-agent": "aura-oracle/1.0",
      })) as XResponse;

      const users = new Map((res.includes?.users ?? []).map((u) => [u.id, u]));
      const media = new Map((res.includes?.media ?? []).map((m) => [m.media_key, m]));

      const items: RawDatum[] = [];
      let likes = 0;
      let views = 0;
      const authors = new Set<string>();

      for (const tweet of res.data ?? []) {
        const author = tweet.author_id ? users.get(tweet.author_id) : undefined;
        const followers = author?.public_metrics?.followers_count ?? 0;
        // PRESTIGE GATE: reach or verification. This is the whole point of the
        // adapter — endless low-reach posts are noise, not a market signal.
        if (!author?.verified && followers < minFollowers) continue;

        const m = tweet.public_metrics ?? {};
        const ts = tweet.created_at ? Date.parse(tweet.created_at) : now;
        if (Number.isFinite(ts) && ts < since) continue;

        likes += m.like_count ?? 0;
        views += m.impression_count ?? 0;
        if (author?.username) authors.add(author.username);

        const mediaItems = (tweet.attachments?.media_keys ?? [])
          .map((key) => media.get(key))
          .filter((x): x is XMedia => Boolean(x))
          .flatMap((x) => {
            const url = x.type === "photo" ? x.url : x.preview_image_url;
            return url
              ? [{ kind: (x.type === "photo" ? "image" : "video") as "image" | "video", url }]
              : [];
          });

        items.push({
          id: tweet.id,
          sourceName: this.label(config),
          text: tweet.text,
          url: author?.username ? `https://x.com/${author.username}/status/${tweet.id}` : undefined,
          author: author?.username
            ? `@${author.username} (${formatCount(followers)} followers${author.verified ? ", verified" : ""})`
            : undefined,
          publishedAt: Number.isFinite(ts) ? ts : now,
          engagement: m.like_count ?? 0,
          stats: {
            likes: m.like_count ?? 0,
            replies: m.reply_count ?? 0,
            reposts: (m.retweet_count ?? 0) + (m.quote_count ?? 0),
            views: m.impression_count ?? 0,
            followers,
          },
          media: mediaItems.length ? mediaItems : undefined,
        });
      }

      const t = bucketStart(now);
      return {
        points: {
          posts: [{ timestamp: t, value: items.length }],
          likes: [{ timestamp: t, value: likes }],
          views: [{ timestamp: t, value: views }],
          authors: [{ timestamp: t, value: authors.size }],
        },
        items,
      };
    } catch {
      // 401/429/network — an empty sample keeps the tick alive without inventing
      // engagement. The health surface shows the source as unconfigured/failing.
      return { points: {} };
    }
  }
}

function bearer(credentials?: AdapterCredentials): string | undefined {
  const bag = credentials as unknown as Record<string, unknown> | undefined;
  const secrets = bag?.secrets as Record<string, unknown> | undefined;
  const values = bag?.values as Record<string, unknown> | undefined;
  // The bearer can arrive as a top-level field, the ConnectionStore secrets bag
  // (app-level key), or a nested `values` map — accept all three shapes.
  const candidates = [
    bag?.bearerToken,
    bag?.["x:bearerToken"],
    secrets?.bearerToken,
    secrets?.["x:bearerToken"],
    values?.bearerToken,
    values?.["x:bearerToken"],
  ];
  return candidates.find((v): v is string => typeof v === "string" && v.length > 0);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
