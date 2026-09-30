import type { CategoryId } from "./aura-data";

// ----------------------------------------------------------------------------
// The social feed.
//
// The landing page is a timeline: every market is a @handle and every
// post is an *aggregate* internet-feed summary for that handle — a handcrafted
// digest rolled up from several underlying sources (X, Reddit, YouTube, news),
// each source carrying its own ±aura contribution. Opening a post shows the
// full text plus the source breakdown and a trade CTA for the handle's market.
//
// All timestamps are static strings ("4h", "4:00 PM", "Sep 26, 2026") so SSR
// and client markup match — no Date.now() during render.
// ----------------------------------------------------------------------------

export type FeedPlatform = "x" | "reddit" | "youtube" | "news" | "tiktok";

export type FeedSource = {
  id: string;
  platform: FeedPlatform;
  /** Source account — "@goalzone", "r/soccer", "ESPN". */
  account: string;
  /** The underlying source post, verbatim-ish. */
  text: string;
  /** Static relative time of the source post. */
  ts: string;
  /** What this single source contributed to the aggregate aura. */
  aura: number;
  /** Optional engagement hint — "12.4K likes". */
  stats?: string;
};

export type FeedMedia =
  | { kind: "image"; src: string; alt: string }
  | { kind: "video"; src: string; alt: string };

export type FeedComment = {
  id: string;
  user: string;
  handle: string;
  color: string;
  text: string;
  /** Attached reaction GIF (/gifs/… or https URL). */
  media?: string | null;
  ts: string;
  /** True for the current user's own replies. */
  mine?: boolean;
};

export type FeedPost = {
  id: string;
  /** Market this post trades — the handle's asset id. */
  marketId: string;
  /** Handle the post belongs to — "@messi", "@67", "@ai". */
  handle: string;
  /**
   * The handle's bytes32 id — the authoritative identity. Handle links resolve
   * from this (its decoded label is the canonical slug), never from the display
   * name, so "Elon Musk" still links to `/elon`.
   */
  handleId?: string;
  /** Display name shown bold in the timeline. */
  name: string;
  /** Binary markets get their real asset artwork as the avatar. */
  assetId?: string;
  category: CategoryId;
  /** Static relative time in the timeline — "4h". */
  ts: string;
  /** Absolute stamp for the detail page — "4:00 PM". */
  time: string;
  /** Absolute date for the detail page — "Sep 26, 2026". */
  date: string;
  /** Aggregated feed summary shown in the timeline (with "read more"). */
  summary: string;
  /** Full text shown on the post detail page. */
  body: string[];
  /** Absolute epoch ms when the post was published (drives live feeds). */
  createdAt?: number;
  media?: FeedMedia[];
  stats: { replies: number; reposts: number; likes: number; views: number };
  /** Underlying sources rolled up into `summary` / `body`. */
  sources: FeedSource[];
};
