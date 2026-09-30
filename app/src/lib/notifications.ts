/**
 * Notification feed — shared by the rail popover and the /notifications page.
 * Server-backed (`GET /social/:userId/notifications`): read state lives in
 * Postgres; mark-read / mark-unread / mark-all-read all hit their endpoints.
 */
import { useContext, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  AtSign,
  Bell,
  Flame,
  Heart,
  Repeat,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { AuraAuthContext } from "@/lib/aura-auth";
import { timeAgo } from "@/lib/format";
import { usePollGate } from "@/lib/poll-registry";
import { qk } from "@/queries/keys";
import {
  notificationsOptions,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMarkNotificationUnread,
} from "@/queries/notifications";
import { flatPages } from "@/queries/page";

export type Notification = {
  id: string;
  icon: LucideIcon;
  tint: string;
  title: string;
  body: string;
  /** Relative stamp shown in both views, e.g. "18m". */
  time: string;
  group: "Today" | "Earlier";
  /** Destination post/page — items without one are plain alerts. */
  to?: string;
};

const KIND_META: Record<string, { icon: LucideIcon; tint: string }> = {
  post: { icon: Flame, tint: "text-primary bg-primary/15" },
  shock: { icon: Zap, tint: "text-amber-500 bg-amber-500/15" },
  resolution: { icon: Trophy, tint: "text-[hsl(43_90%_50%)] bg-[hsl(43_90%_50%)]/15" },
  follow: { icon: Users, tint: "text-link bg-link/15" },
  like: { icon: Heart, tint: "text-down bg-down/15" },
  repost: { icon: Repeat, tint: "text-up bg-up/15" },
  mention: { icon: AtSign, tint: "text-primary bg-primary/15" },
};

export type NotificationView = {
  /** Visible items. */
  items: Notification[];
  isRead: (id: string) => boolean;
  unread: number;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  markAllRead: () => void;
  /** Attach to the surface showing this feed — gates the 30s poll. */
  gateRef: { current: HTMLDivElement | null };
};

export function useNotifications(): NotificationView {
  const authCtx = useContext(AuraAuthContext);
  const userId = (authCtx?.auth.address ?? null)?.toLowerCase() ?? null;
  const query = useInfiniteQuery({ ...notificationsOptions(userId ?? ""), enabled: !!userId });
  const gateRef = usePollGate<HTMLDivElement>(qk.notifications(userId ?? ""));
  const markOne = useMarkNotificationRead(userId);
  const unmarkOne = useMarkNotificationUnread(userId);
  const markAll = useMarkAllNotificationsRead(userId);

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  /** Every loaded page, newest first (infinite — no single-page limit). */
  const rows = useMemo(() => flatPages(query.data?.pages), [query.data]);

  const items = useMemo(() => {
    const now = Date.now();
    return rows.map<Notification>((n) => {
      const meta = KIND_META[n.kind] ?? { icon: Bell, tint: "text-foreground bg-secondary" };
      return {
        id: n.id,
        icon: meta.icon,
        tint: meta.tint,
        title: n.title,
        body: n.body,
        time: timeAgo(n.createdAt),
        group: now - n.createdAt < 24 * 3600_000 ? "Today" : "Earlier",
        to: n.postId ? `/post/${n.postId}` : undefined,
      };
    });
  }, [rows]);

  const readSet = useMemo(() => {
    const set = new Set<string>();
    for (const n of rows) if (n.read) set.add(n.id);
    for (const [id, read] of Object.entries(overrides)) {
      if (read) set.add(id);
      else set.delete(id);
    }
    return set;
  }, [rows, overrides]);

  return {
    items,
    gateRef,
    isRead: (id: string) => readSet.has(id),
    unread: items.filter((n) => !readSet.has(n.id)).length,
    markRead: (id: string) => {
      setOverrides((prev) => ({ ...prev, [id]: true }));
      markOne.mutate(id);
    },
    markUnread: (id: string) => {
      setOverrides((prev) => ({ ...prev, [id]: false }));
      unmarkOne.mutate(id);
    },
    markAllRead: () => {
      const ids = rows.map((n) => n.id);
      setOverrides((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = true;
        return next;
      });
      markAll.mutate();
    },
  };
}
