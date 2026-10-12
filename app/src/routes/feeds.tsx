import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { FeedLayout } from "@/components/social/FeedLayout";
import { FeedSearch, SidebarFooter } from "@/components/social/RightSidebar";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { FeedItem } from "@/components/feeds/FeedItem";
import { QueryError } from "@/components/QueryState";
import { FeedItemSkeleton } from "@/components/ui/skeletons";
import { useAuraAuth } from "@/lib/aura-auth";
import { useAuraContracts } from "@/lib/contracts";
import { feedOptions, postsOptions } from "@/queries/posts";
import { flatPages } from "@/queries/page";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/feeds")({
  validateSearch: (search: Record<string, unknown>): { tab?: "for-you" | "following" } => ({
    tab: search.tab === "following" ? "following" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Feeds — Aura" },
      {
        name: "description",
        content:
          "Every source digest the oracle publishes — what the internet is talking about now.",
      },
    ],
  }),
  component: FeedsPage,
});

/**
 * The oracle's published feeds. "For you" is every digest; "Following" is the
 * server-side feed of the handles you follow (wallet required). Reading only —
 * markets are traded on each handle's page.
 */
function FeedsPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { address } = useAuraContracts();
  const { login } = useAuraAuth();
  const userId = address?.toLowerCase() ?? null;

  const activeTab: "for-you" | "following" = tab === "following" ? "following" : "for-you";

  const allQuery = useInfiniteQuery({
    ...postsOptions(undefined, 20),
    enabled: activeTab === "for-you",
  });
  const followingQuery = useInfiniteQuery({
    ...feedOptions(userId),
    enabled: activeTab === "following" && !!userId,
  });
  const query = activeTab === "following" ? followingQuery : allQuery;
  const posts = flatPages(query.data?.pages);

  // `/feeds/:id` (a feed's own page) is a CHILD of this route — hand it the
  // render instead of drawing the list underneath it. Hooks above are called
  // unconditionally so the Rules of Hooks stay satisfied.
  if (pathname.replace(/\/+$/, "") !== "/feeds") return <Outlet />;

  const setTab = (id: "for-you" | "following") =>
    navigate({ search: id === "following" ? { tab: "following" } : {}, replace: true });

  return (
    <FeedLayout
      sidebar={
        <>
          <FeedSearch />
          <section className="rounded-2xl border border-border/70 bg-card p-4">
            <h2 className="text-sm font-semibold">What feeds are</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The oracle reads every source a handle connects, scores the buzz, and publishes one
              digest. Each entry below lists the outlets it was built from.
            </p>
          </section>
          <SidebarFooter />
        </>
      }
    >
      <div className="px-4 pt-8 pb-5 sm:px-6">
        <h1 className="text-2xl font-bold sm:text-3xl">Feeds</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          What the internet is talking about right now — published by the oracle, sourced from the
          handles&apos; own feeds.
        </p>
      </div>

      {/* Tabs — same pattern as the explore filters. `top` clears the sticky
          mobile Navbar below lg (--app-topbar), and is 0 at lg. */}
      <div className="sticky top-[var(--app-topbar)] z-30 flex border-b border-border/70 bg-background/90 backdrop-blur-md">
        {(
          [
            ["for-you", "For you"],
            ["following", "Following"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "relative flex-1 px-4 py-3 text-sm transition-colors",
              activeTab === id
                ? "font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {activeTab === id && (
              <span className="absolute inset-x-8 bottom-0 h-0.5 rounded-full bg-foreground" />
            )}
          </button>
        ))}
      </div>

      {/* Following needs a wallet — say so instead of showing an empty list */}
      {activeTab === "following" && !userId ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-sm font-semibold">Connect a wallet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Your following feed follows your account — sign in to see the handles you subscribe
            to.
          </p>
          <button
            type="button"
            onClick={() => void login()}
            className="mt-2 min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110"
          >Sign in</button>
        </div>
      ) : (
        <>
          <div className="divide-y divide-border/60">
            {query.isPending &&
              Array.from({ length: 4 }, (_, i) => <FeedItemSkeleton key={i} />)}

            {query.isError && (
              <QueryError what="the feeds" onRetry={() => void query.refetch()} className="my-6 border-0" />
            )}

            {!query.isError &&
              posts.map((p) => <FeedItem key={p.id} post={p} />)}
            {!query.isPending && !query.isError && posts.length === 0 && (
              <div className="px-4 py-16 text-center sm:px-6">
                <p className="text-sm font-semibold">
                  {activeTab === "following"
                    ? "Your handles are quiet"
                    : "No tea yet"}
                </p>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                  {activeTab === "following"
                    ? "Follow a handle from its page and its digests land here."
                    : "Digests drop as soon as a handle's sources report in."}
                </p>
              </div>
            )}
          </div>

          {query.hasNextPage && (
            <InfiniteSentinel
              ready={!query.isFetchingNextPage}
              onEnd={() => void query.fetchNextPage()}
            />
          )}
        </>
      )}
    </FeedLayout>
  );
}
