import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, CheckCheck, Flame, Repeat2, Sparkles, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FeedLayout } from "@/components/social/FeedLayout";
import { FeedSearch, SidebarFooter } from "@/components/social/RightSidebar";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { QueryError } from "@/components/QueryState";
import { Skeleton } from "@/components/ui/skeletons";
import { useAuraContracts } from "@/lib/contracts";
import { useAuraAuth } from "@/lib/aura-auth";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  type NotificationItem,
} from "@/queries/notifications";
import { flatPages } from "@/queries/page";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Aura" }] }),
  component: NotificationsPage,
});

/** Icon + tint per notification kind — the backend sends the kind, we style it. */
function look(kind: string): { icon: LucideIcon; tint: string } {
  if (kind.includes("follow")) return { icon: Sparkles, tint: "text-primary" };
  if (kind.includes("comment")) return { icon: Bell, tint: "text-link" };
  if (kind.includes("repost")) return { icon: Repeat2, tint: "text-up" };
  if (kind.includes("aura") || kind.includes("window"))
    return { icon: Flame, tint: "text-down" };
  if (kind.includes("leaderboard") || kind.includes("rank"))
    return { icon: Trophy, tint: "text-[hsl(43_90%_50%)]" };
  return { icon: Bell, tint: "text-muted-foreground" };
}

/**
 * Notifications — the oracle's user-scoped list, pushed live over the socket
 * (`notification` messages invalidate this query). Opening one marks it read.
 */
function NotificationsPage() {
  const { address } = useAuraContracts();
  const { login } = useAuraAuth();
  const userId = address?.toLowerCase() ?? null;
  const query = useNotifications(userId ?? "");
  const markRead = useMarkNotificationRead(userId);
  const markAll = useMarkAllNotificationsRead(userId);
  const items = flatPages(query.data?.pages);
  const unread = items.filter((n) => !n.read).length;

  return (
    <FeedLayout
      sidebar={
        <>
          <FeedSearch />
          <section className="rounded-2xl border border-border/70 bg-card p-4">
            <h2 className="text-sm font-semibold">What lands here</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              Aura pings you when a handle you follow moves, when your digests get replies, and
              when a window you traded settles.
            </p>
          </section>
          <SidebarFooter />
        </>
      }
    >
      <div className="flex items-end justify-between gap-3 px-4 pt-8 pb-4 sm:px-6">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight sm:text-3xl">Notifications</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {userId
              ? unread > 0
                ? `${unread} unread`
                : "You're all caught up."
              : "Sign in to see your notifications."}
          </p>
        </div>
        {userId && unread > 0 && (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </button>
        )}
      </div>

      {!userId ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 text-center">
          <Bell className="h-6 w-6 text-muted-foreground" />
          <p className="text-[15px] font-semibold">Connect a wallet</p>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Notifications are bound to your account — sign in to load them.
          </p>
          <button
            type="button"
            onClick={() => void login()}
            className="mt-1 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110"
          >
            Connect wallet
          </button>
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {query.isPending &&
            [0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-4 sm:px-6">
                <Skeleton className="h-8 w-8 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="mt-2 h-3 w-3/4" />
                </div>
              </div>
            ))}

          {query.isError && (
            <QueryError
              what="your notifications"
              onRetry={() => void query.refetch()}
              className="my-6 border-0"
            />
          )}

          {!query.isError &&
            items.map((n) => <Row key={n.id} item={n} onOpen={() => markRead.mutate(n.id)} />)}

          {!query.isPending && !query.isError && items.length === 0 && (
            <div className="px-4 py-16 text-center sm:px-6">
              <p className="text-[15px] font-semibold">Nothing yet</p>
              <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
                Follow a handle and trade a window — the pings start there.
              </p>
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

function Row({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  const { icon: Icon, tint } = look(item.kind);
  const body = (
    <div className="flex items-start gap-3 px-4 py-4 transition-colors sm:px-6">
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-secondary/60",
          tint,
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold">{item.title}</span>
          {!item.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{item.body}</p>
        <span className="mt-1 block text-[11px] text-muted-foreground/70">
          {timeAgo(item.createdAt)}
        </span>
      </div>
    </div>
  );

  // Where the ping points (a feed, a handle page) — reading it marks it read.
  return item.postId ? (
    <Link
      to="/feeds/$id"
      params={{ id: item.postId }}
      onClick={onOpen}
      className="block hover:bg-secondary/25"
    >
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onOpen} className="block w-full text-left hover:bg-secondary/25">
      {body}
    </button>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
