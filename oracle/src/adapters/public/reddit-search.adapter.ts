import type { AdapterCredentials, AdapterSample, MetricDef, SourceConfig } from "../../core/domain/source";
import type { RawDatum } from "../../core/domain/source-item";
import { BaseSource } from ".././base-source";
import { apiGetJson, bucketStart } from ".././http";
import { fetchText } from "../../ingestion/http";
import { parseFeed } from "../../ingestion/rss-parser";

type RedditChild = {
  data?: {
    id?: string;
    title?: string;
    selftext?: string;
    author?: string;
    subreddit?: string;
    permalink?: string;
    created_utc?: number;
    score?: number;
    num_comments?: number;
    upvote_ratio?: number;
    link_flair_text?: string;
    thumbnail?: string;
    preview?: { images?: { source?: { url?: string } }[] };
  };
};

/**
 * Reddit adapter — what a community is saying, plus its own health metrics.
 *
 * TWO MODES, both public (no auth; an optional token raises the rate limit):
 *  - `subreddit`: the community's own numbers (subscribers / active / post
 *    volume) — no text;
 *  - `query` (or `subreddit` + `query`): the actual POSTS matching a subject,
 *    each with its author, score, comment count, upvote ratio and image, so
 *    Reddit contributes real "talks" to the aura read instead of a bare count.
 *
 * `minScore` (default 25) is the prestige floor: a post nobody upvoted is one
 * person's opinion, not community chatter.
 */
export class RedditSearchAdapter extends BaseSource {
  readonly platform = "reddit";
  readonly weight = 620; // 1-1000 credibility
  readonly kind = "community" as const;
  readonly fetchIntervalMs = 5 * 60_000;
  readonly requiredCredentials = [] as const;

  readonly metrics: MetricDef[] = [
    { key: "subscribers", label: "Subscribers", unit: "subscribers", higherIsBetter: true, source: "Reddit JSON /r/{sub}/about" },
    { key: "active", label: "Active", unit: "users", higherIsBetter: true, source: "Reddit JSON /r/{sub}/about" },
    { key: "posts", label: "Posts", unit: "posts", higherIsBetter: true, source: "Reddit JSON /r/{sub}/new" },
    { key: "score", label: "Post score", unit: "upvotes", higherIsBetter: true, source: "Reddit JSON search" },
    { key: "comments", label: "Comments", unit: "comments", higherIsBetter: true, source: "Reddit JSON search" },
  ];

  id(config: SourceConfig): string {
    const sub = this.str(config, "subreddit");
    const query = this.str(config, "query");
    if (sub && query) return `reddit-${sub}-${slug(query)}`;
    if (query) return `reddit-${slug(query)}`;
    return `reddit-${sub ?? "unknown"}`;
  }

  label(config: SourceConfig): string {
    const sub = this.str(config, "subreddit");
    const query = this.str(config, "query");
    if (query) return sub ? `r/${sub} · "${query}"` : `Reddit · "${query}"`;
    return `r/${sub ?? "unknown"}`;
  }

  async fetch(
    config: SourceConfig,
    since: number,
    now: number,
    _credentials?: AdapterCredentials,
  ): Promise<AdapterSample> {
    const sub = this.str(config, "subreddit");
    const query = this.str(config, "query");
    const headers = { "user-agent": "aura-oracle/1.0" };
    const t = bucketStart(now);
    const points: Record<string, { timestamp: number; value: number }[]> = {};
    const items: RawDatum[] = [];

    try {
      // Community health (only meaningful with a subreddit).
      if (sub) {
        const about = (await apiGetJson(
          `https://www.reddit.com/r/${encodeURIComponent(sub)}/about.json`,
          headers,
        )) as { data?: { subscribers?: number; active_user_count?: number } };
        points.subscribers = [{ timestamp: t, value: about.data?.subscribers ?? 0 }];
        points.active = [{ timestamp: t, value: about.data?.active_user_count ?? 0 }];
      }

      // The talks: a subject search (optionally scoped to the subreddit).
      if (query) {
        const url = sub
          ? `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=25`
          : `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=25`;
        const minScore = this.num(config, "minScore") ?? 25;
        let score = 0;
        let comments = 0;

        let children: RedditChild[] = [];
        try {
          const found = (await apiGetJson(url, headers)) as { data?: { children?: RedditChild[] } };
          children = found.data?.children ?? [];
        } catch {
          // Reddit now answers the public JSON with an HTML "blocked" page. Fall
          // back to the RSS search — text only (RSS carries no score/comments),
          // so Reddit still contributes its TALKS; OAuth credentials restore the
          // engagement numbers.
          children = [];
        }

        if (children.length === 0) {
          const rssUrl = sub
            ? `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.rss?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new`
            : `https://www.reddit.com/search.rss?q=${encodeURIComponent(query)}&sort=new`;
          try {
            const xml = await fetchText(rssUrl, { timeoutMs: 15_000 });
            const entries = parseFeed(xml, this.label(config)).filter((d) => !since || d.publishedAt >= since);
            for (const entry of entries.slice(0, 25)) {
              items.push({
                id: entry.id,
                sourceName: this.label(config),
                text: entry.text,
                url: entry.url,
                // RSS gives the author in the entry title/author field only.
                author: entry.author,
                publishedAt: entry.publishedAt,
                media: entry.media,
              });
            }
            points.posts = [{ timestamp: t, value: items.length }];
          } catch {
            /* both paths blocked — contribute nothing rather than noise */
          }
          return { points, items };
        }

        for (const child of children) {
          const p = child.data;
          if (!p?.title) continue;
          // PRESTIGE FLOOR: skip the posts nobody engaged with.
          if ((p.score ?? 0) < minScore) continue;
          const ts = (p.created_utc ?? 0) * 1000;
          if (ts && ts < since) continue;

          score += p.score ?? 0;
          comments += p.num_comments ?? 0;
          const preview = p.preview?.images?.[0]?.source?.url ?? undefined;
          const thumb = p.thumbnail?.startsWith("http") ? p.thumbnail : undefined;

          items.push({
            id: p.id,
            sourceName: this.label(config),
            text: `${p.title}${p.selftext ? ` — ${p.selftext}` : ""}`.slice(0, 400),
            url: p.permalink ? `https://www.reddit.com${p.permalink}` : undefined,
            author: p.author
              ? `u/${p.author}${p.subreddit ? ` · r/${p.subreddit}` : ""}`
              : undefined,
            publishedAt: ts || now,
            engagement: p.score ?? 0,
            stats: {
              score: p.score ?? 0,
              replies: p.num_comments ?? 0,
              upvoteRatio: Math.round((p.upvote_ratio ?? 0) * 100),
            },
            media: preview || thumb ? [{ kind: "image", url: (preview ?? thumb)! }] : undefined,
          });
        }

        points.posts = [{ timestamp: t, value: items.length }];
        points.score = [{ timestamp: t, value: score }];
        points.comments = [{ timestamp: t, value: comments }];
      } else if (sub) {
        const newPosts = (await apiGetJson(
          `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=25`,
          headers,
        )) as { data?: { children?: unknown[] } };
        points.posts = [{ timestamp: t, value: newPosts.data?.children?.length ?? 0 }];
      }

      return { points, items };
    } catch {
      return { points: {} };
    }
  }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}
