import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bookmark, Eye, Heart, MessageCircle, Repeat2, Sparkles } from "lucide-react";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { AuraText } from "@/components/aura/AuraTerm";
import { handleSlug } from "@/lib/handle-id";
import { formatCompact, hasCount } from "@/lib/format";
import { CATEGORY_MAP } from "@/lib/aura-data";
import { useSocial } from "@/lib/social-store";
import type { FeedPost } from "@/lib/aura-feed";
import { cn } from "@/lib/utils";

/**
 * THE feed item — one oracle digest, used by the feeds list, the handle page's
 * Feeds tab and anywhere else a digest appears. The whole item opens
 * `/feeds/:id`; the author, Trade and "read more" affordances sit above that
 * overlay so they keep their own targets.
 *
 * `variant="row"` is the full width list entry (media, all sources, stats).
 * `variant="compact"` is the tighter card used inside a handle's tab.
 */
export function FeedItem({
  post,
  variant = "row",
  className,
}: {
  post: FeedPost;
  variant?: "row" | "compact";
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { isLiked, toggleLike, isReposted, toggleRepost, isBookmarked, toggleBookmark } =
    useSocial();
  const liked = isLiked(post.id);
  const reposted = isReposted(post.id);
  const saved = isBookmarked(post.id);
  // Resolve the handle from its authoritative bytes32 id; the `handle` label
  // (not the display name) is the fallback so a rename can't move the link.
  const slug = handleSlug({
    id: post.handleId ?? post.handle,
    name: post.handle ?? post.name,
  });
  const cat = CATEGORY_MAP[post.category];
  const compact = variant === "compact";

  // Only counters the platform actually reported; `undefined` renders nothing.
  const likes = post.stats?.likes;
  const reposts = post.stats?.reposts;
  const replies = post.stats?.replies;
  const views = post.stats?.views;

  const body = compact ? post.body.slice(0, 1) : expanded ? post.body : post.body.slice(0, 1);
  const more = !compact && (post.body.length > 1 || (post.body[0]?.length ?? 0) > 180);
  // The compact variant (market pages) shows ONE image rather than none: a trade
  // page should still show what the post is about, just not the full-width media
  // strip the row variant uses, which would push the trading controls down.
  const media = (post.media ?? []).slice(0, compact ? 1 : 2);
  const sources = post.sources.slice(0, compact ? 3 : 4);

  return (
    <article
      className={cn(
        "relative transition-colors hover:bg-secondary/20",
        compact ? "px-4 py-4" : "px-4 py-5 sm:px-6",
        className,
      )}
    >
      {/* Whole item → the feed page */}
      <Link
        to="/feeds/$id"
        params={{ id: post.id }}
        aria-label={post.summary}
        className="absolute inset-0 z-10"
      />

      <div className="flex items-center gap-3">
        <AssetAvatar
          asset={{
            id: post.handleId ?? post.handle,
            symbol: (post.name || post.handle).toUpperCase().slice(0, 4),
            color: "hsl(var(--primary))",
            name: post.name,
          }}
          size={compact ? 32 : 38}
        />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5">
            <Link
              to="/$id"
              params={{ id: slug }}
              className={cn(
                "relative z-20 truncate font-semibold hover:underline",
                compact ? "text-sm" : "text-sm",
              )}
            >
              {post.name}
            </Link>
            <span className="truncate text-xs text-muted-foreground">{post.handle}</span>
            {(likes ?? 0) + (reposts ?? 0) > 0 && (
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {cat?.label ?? "Market"} · {post.ts}
            {compact ? post.sources.length > 0 && ` · ${post.sources.length} sources` : null}
          </div>
        </div>
        {compact ? (
          <span className="shrink-0 text-xs font-medium text-muted-foreground">Read →</span>
        ) : (
          <Link
            to="/$id"
            params={{ id: slug }}
            className="relative z-20 flex min-h-9 shrink-0 items-center rounded-full border border-border/70 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Trade
          </Link>
        )}
      </div>

      <h3
        className={cn(
          "font-semibold leading-snug",
          compact ? "mt-3 text-sm" : "mt-4 text-base",
        )}
      >
        <AuraText text={post.summary} />
      </h3>

      {body.length > 0 && (
        <div
          className={cn(
            "space-y-1.5 leading-relaxed text-muted-foreground",
            compact ? "mt-1.5 text-sm" : "mt-2 text-sm",
          )}
        >
          {body.map((line, i) => (
            <p key={i} className={expanded ? undefined : "line-clamp-2"}>
              {line}
            </p>
          ))}
          {more && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="relative z-20 text-sm font-medium text-primary transition-colors hover:underline"
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}

      {media.length > 0 && (
        <div
          className={cn(
            "gap-2",
            compact ? "mt-2 flex flex-wrap" : "mt-3 grid sm:grid-cols-2",
          )}
        >
          {media.map((m, i) =>
            m.kind === "video" ? (
              <video
                key={i}
                src={m.src}
                controls
                className={cn(
                  "relative z-20 overflow-hidden bg-secondary object-cover",
                  compact
                    ? "h-14 w-auto max-w-[112px] rounded-xl"
                    : "aspect-video w-full rounded-2xl",
                )}
              />
            ) : (
              <img
                key={i}
                src={m.src}
                alt={m.alt ?? ""}
                loading="lazy"
                className={cn(
                  "overflow-hidden object-cover",
                  compact
                    ? "h-14 w-auto max-w-[112px] rounded-xl"
                    : "aspect-video w-full rounded-2xl",
                )}
              />
            ),
          )}
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <span
              key={s.id}
              title={s.text}
              className={cn(
                "truncate rounded-full border border-border/70 text-xs text-muted-foreground",
                compact ? "max-w-[180px] px-2 py-1" : "max-w-[220px] px-2.5 py-1",
              )}
            >
              {s.account || s.platform}
            </span>
          ))}
          {post.sources.length > sources.length && (
            <span className="rounded-full px-2.5 py-1 text-xs text-muted-foreground">
              +{post.sources.length - sources.length}
            </span>
          )}
        </div>
      )}

      {/* Engagements — like / repost / save are real, comments are read-only */}
      <div
        className={cn(
          "relative z-20 flex items-center gap-5 text-muted-foreground",
          compact ? "mt-3 text-xs" : "mt-4 text-xs",
        )}
      >
        <button
          type="button"
          aria-label="Like"
          aria-pressed={liked}
          onClick={() => toggleLike(post.id)}
          className={cn(
            "flex min-h-11 items-center gap-1.5 transition-colors hover:text-down sm:min-h-0",
            liked && "text-down",
          )}
        >
          <Heart className={cn("h-3.5 w-3.5", liked && "fill-current")} />
          {hasCount(likes) && <span aria-live="polite">{formatCompact(likes)}</span>}
        </button>

        <button
          type="button"
          aria-label="Repost"
          aria-pressed={reposted}
          onClick={() => toggleRepost(post.id)}
          className={cn(
            "flex min-h-11 items-center gap-1.5 transition-colors hover:text-up sm:min-h-0",
            reposted && "text-up",
          )}
        >
          <Repeat2 className="h-3.5 w-3.5" />
          {hasCount(reposts) && <span aria-live="polite">{formatCompact(reposts)}</span>}
        </button>

        {/* The counts were `title=`-only: invisible to assistive tech and useless
            on touch. They are labelled text now, not a tooltip. A count the
            platform never reported renders nothing at all. */}
        {hasCount(replies) && (
          <span className="flex min-h-11 items-center gap-1.5 sm:min-h-0">
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Comments </span>
            <span aria-live="polite">{formatCompact(replies)}</span>
          </span>
        )}

        <button
          type="button"
          aria-label="Save"
          aria-pressed={saved}
          onClick={() => toggleBookmark(post.id)}
          className={cn(
            "flex min-h-11 items-center gap-1.5 transition-colors hover:text-primary sm:min-h-0",
            saved && "text-primary",
          )}
        >
          <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} />
        </button>

        {hasCount(views) && (
          <span className="flex min-h-11 items-center gap-1.5 sm:min-h-0">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Impressions </span>
            <span>{formatCompact(views)}</span>
          </span>
        )}

        {!compact && (
          <Link
            to="/$id"
            params={{ id: slug }}
            className="ml-auto transition-colors hover:text-foreground"
          >
            Open market
          </Link>
        )}
      </div>
    </article>
  );
}
