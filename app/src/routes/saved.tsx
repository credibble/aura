import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bookmark, Repeat2 } from "lucide-react";
import { FeedLayout } from "@/components/social/FeedLayout";
import { FeedSearch, SidebarFooter } from "@/components/social/RightSidebar";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { FeedItem } from "@/components/feeds/FeedItem";
import { QueryError } from "@/components/QueryState";
import { FeedItemSkeleton } from "@/components/ui/skeletons";
import { toFeedPost } from "@/queries/posts";
import { bookmarksOptions, repostedPostsOptions } from "@/queries/social";
import { flatPages } from "@/queries/page";
import { useAuraContracts } from "@/lib/contracts";
import { useAuraAuth } from "@/lib/aura-auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/saved")({
  validateSearch: (search: Record<string, unknown>): { tab?: "reposts" } => ({
    tab: search.tab === "reposts" ? "reposts" : undefined,
  }),
  head: () => ({ meta: [{ title: "Saved — Aura" }] }),
  component: SavedPage,
});

/**
 * Saved — the feeds you kept, split into bookmarks and your reposts. Both are
 * server-owned lists (`GET /social/bookmarks` · `GET /social/reposted`), so this
 * page is the destination for the save/repost buttons on every feed item.
 */
function SavedPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { address } = useAuraContracts();
  const { login } = useAuraAuth();
  const userId = address?.toLowerCase() ?? null;
  const active: "saved" | "reposts" = tab === "reposts" ? "reposts" : "saved";

  const savedQuery = useInfiniteQuery({
    ...bookmarksOptions(userId),
    enabled: !!userId && active === "saved",
  });
  const repostsQuery = useInfiniteQuery({
    ...repostedPostsOptions(userId),
    enabled: !!userId && active === "reposts",
  });
  const query = active === "reposts" ? repostsQuery : savedQuery;
  const posts = useMemo(
    () => flatPages(query.data?.pages).map((p) => toFeedPost(p)),
    [query.data],
  );

  const go = (id: "saved" | "reposts") => {
    if (id === active) return;
    navigate({ search: id === "reposts" ? { tab: "reposts" } : {}, replace: true });
  };

  return (
    <FeedLayout
      sidebar={
        <>
          <FeedSearch />
          <section className="rounded-2xl border border-border/70 bg-card p-4">
            <h2 className="text-sm font-semibold">Saved</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              Bookmark a digest from its feed page (or the bookmark icon on any feed item) and it
              lands here. Reposts are the digests you amplified.
            </p>
          </section>
          <SidebarFooter />
        </>
      }
    >
      <div className="px-4 pt-8 pb-4 sm:px-6">
        <h1 className="text-[26px] font-bold tracking-tight sm:text-3xl">Saved</h1>
        <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
          Feeds you kept, and the ones you reposted.
        </p>
      </div>

      <div className="sticky top-[var(--app-topbar)] z-30 flex border-b border-border/70 bg-background/90 backdrop-blur-md">
        {(
          [
            ["saved", "Bookmarks", Bookmark],
            ["reposts", "Reposts", Repeat2],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => go(id)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 px-4 py-3 text-sm transition-colors",
              active === id
                ? "font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {active === id && (
              <span className="absolute inset-x-8 bottom-0 h-0.5 rounded-full bg-foreground" />
            )}
          </button>
        ))}
      </div>

      {!userId ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="text-[15px] font-semibold">Connect a wallet</p>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Saves and reposts belong to your account — sign in to see them.
          </p>
          <button
            type="button"
            onClick={() => void login()}
            className="mt-1 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110"
          >Sign in</button>
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {query.isPending && [0, 1, 2].map((i) => <FeedItemSkeleton key={i} />)}
          {query.isError && (
            <QueryError what="your saved posts" onRetry={() => void query.refetch()} className="my-6 border-0" />
          )}
          {!query.isError && posts.map((p) => (
            <FeedItem key={p.id} post={p} />
          ))}
          {!query.isPending && !query.isError && posts.length === 0 && (
            <div className="px-4 py-16 text-center sm:px-6">
              <p className="text-[15px] font-semibold">
                {active === "reposts" ? "No reposts yet" : "Nothing stashed yet"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
                {active === "reposts"
                  ? "Repost a digest and it shows up here."
                  : "Tap the bookmark on a feed to stash it."}
              </p>
              <Link
                to="/feeds"
                className="mt-4 inline-flex rounded-full border border-border/70 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                Browse feeds
              </Link>
            </div>
          )}
          {query.hasNextPage && (
            <InfiniteSentinel
              ready={!query.isFetchingNextPage}
              onEnd={() => void query.fetchNextPage()}
            />
          )}
        </div>
      )}
    </FeedLayout>
  );
}
