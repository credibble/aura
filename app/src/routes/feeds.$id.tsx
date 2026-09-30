import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  Repeat2,
  Sparkles,
} from "lucide-react";
import { FeedLayout } from "@/components/social/FeedLayout";
import { FeedSearch } from "@/components/social/RightSidebar";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { AuraText } from "@/components/aura/AuraTerm";
import { FeedComments } from "@/components/feeds/FeedComments";
import { CommentSkeleton, FeedItemSkeleton, Skeleton } from "@/components/ui/skeletons";
import { handleSlug } from "@/lib/handle-id";
import { formatCompact } from "@/lib/format";
import { CATEGORY_MAP } from "@/lib/aura-data";
import { postOptions } from "@/queries/posts";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/feeds/$id")({
  head: () => ({ meta: [{ title: "Feed — Aura" }] }),
  component: FeedDetailPage,
});

/**
 * One published feed in full: the oracle's digest, every line of it, the real
 * sources it was aggregated from, and the market it belongs to.
 */
function FeedDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const query = useQuery(postOptions(id));
  const post = query.data;

  // Impressions — one view per post per session, straight to the oracle.
  useEffect(() => {
    if (!post) return;
    const key = `aura:viewed:${post.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* private mode — count it anyway */
    }
    void api(`/social/posts/${encodeURIComponent(post.id)}/view`, { method: "POST" }).catch(() => {});
  }, [post]);

  if (query.isPending) {
    return (
      <FeedLayout sidebar={<FeedSearch />}>
        <FeedItemSkeleton />
        <div className="px-4 pb-6 sm:px-6">
          <Skeleton className="h-4 w-24" />
          <CommentSkeleton />
          <CommentSkeleton withGif />
        </div>
      </FeedLayout>
    );
  }

  if (!post) {
    return (
      <FeedLayout sidebar={<FeedSearch />}>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
          <h1 className="text-2xl font-bold">Feed unavailable</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            This digest isn&apos;t published right now — the oracle may be re-indexing.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium hover:bg-secondary"
            >
              Try again
            </button>
            <Link
              to="/feeds"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              All feeds
            </Link>
          </div>
        </div>
      </FeedLayout>
    );
  }

  // The handle's authoritative id drives the link; the display name is only a
  // last resort for rows whose id isn't decodable.
  const slug = handleSlug({
    id: post.handleId ?? post.handle,
    name: post.handle ?? post.name,
  });
  const cat = CATEGORY_MAP[post.category];

  return (
    <FeedLayout sidebar={<FeedSearch />}>
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border/70 bg-background/90 px-4 py-3 backdrop-blur-md sm:px-6 lg:top-0">
        <button
          type="button"
          onClick={() => navigate({ to: "/feeds" })}
          aria-label="Back to feeds"
          className="-ml-2 rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-sm font-semibold">Feed</h1>
      </div>

      <article className="px-4 py-5 sm:px-6">
        <div className="flex items-center gap-3">
          <AssetAvatar
            asset={{
              id: post.handleId ?? post.handle,
              symbol: (post.name || post.handle).toUpperCase().slice(0, 4),
              color: "hsl(var(--primary))",
              name: post.name,
            }}
            size={44}
          />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-1.5">
              <Link
                to="/$id"
                params={{ id: slug }}
                className="truncate text-[15px] font-semibold hover:underline"
              >
                {post.name}
              </Link>
              {post.stats.likes + post.stats.reposts > 0 && (
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
              )}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {post.handle} · {cat?.label ?? "Market"} · {post.date} at {post.time}
            </div>
          </div>
          <Link
            to="/$id"
            params={{ id: slug }}
            className="shrink-0 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110"
          >
            Trade
          </Link>
        </div>

        <h2 className="mt-4 text-[19px] font-bold leading-snug tracking-tight">
          <AuraText text={post.summary} />
        </h2>

        <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-foreground/90">
          {post.body.map((line, i) => (
            <p key={i} className={cn(i === post.body.length - 1 && "text-muted-foreground")}>
              {line}
            </p>
          ))}
        </div>

        {(post.media?.length ?? 0) > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(post.media ?? []).map((m, i) =>
              m.kind === "video" ? (
                <video key={i} src={m.src} controls className="w-full rounded-2xl bg-secondary" />
              ) : (
                <img
                  key={i}
                  src={m.src}
                  alt={m.alt ?? ""}
                  loading="lazy"
                  className="w-full rounded-2xl object-cover"
                />
              ),
            )}
          </div>
        )}

        {/* The real outlets the digest was built from */}
        {post.sources.length > 0 && (
          <section className="mt-6">
            <h3 className="text-sm font-semibold">Sources</h3>
            <div className="mt-2 divide-y divide-border/60">
              {post.sources.map((s) => (
                <div key={s.id} className="flex items-start gap-3 py-3">
                  <span className="mt-0.5 shrink-0 rounded-full border border-border/70 px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
                    {s.platform}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{s.account}</div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                      {s.text}
                    </p>
                  </div>
                  <span className="num shrink-0 text-xs text-muted-foreground">{s.aura}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-6 flex items-center gap-5 border-t border-border/70 pt-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <MessageCircle className="h-3.5 w-3.5" /> {formatCompact(post.stats.replies)}
          </span>
          <span className="flex items-center gap-1.5">
            <Repeat2 className="h-3.5 w-3.5" /> {formatCompact(post.stats.reposts)}
          </span>
          <span className="flex items-center gap-1.5">
            <Heart className="h-3.5 w-3.5" /> {formatCompact(post.stats.likes)}
          </span>
          <span className="flex items-center gap-1.5">
            <Eye className="h-3.5 w-3.5" /> {formatCompact(post.stats.views)}
          </span>
          <Link
            to="/$id"
            params={{ id: slug }}
            className="ml-auto flex items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open market
          </Link>
        </div>
      </article>

      <Link
        to="/feeds"
        className="flex items-center justify-center gap-1.5 border-t border-border/70 py-4 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        All feeds
      </Link>

      {/* Comments — text plus reaction GIFs */}
      <div className="border-t border-border/70">
        <FeedComments postId={post.id} />
      </div>
    </FeedLayout>
  );
}
