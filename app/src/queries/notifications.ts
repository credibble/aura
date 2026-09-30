/**
 * Notification queries — backend-owned (`GET /social/:userId/notifications`),
 * paginated + read-marking with invalidation (bell badge, popover, page).
 */
import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useEnsureJwt } from "@/lib/jwt";
import { qk } from "./keys";
import { nextParam, type Page } from "./page";

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
  postId?: string | null;
};

/** Unread window alerts, newest first — infinite pages (page keys stay out of
 *  the cache key so invalidation refreshes every loaded page). */
export function notificationsOptions(userId: string, limit = 50) {
  return infiniteQueryOptions({
    queryKey: qk.notifications(userId),
    queryFn: async ({ pageParam }) =>
      api<Page<NotificationItem>>(
        `/social/${encodeURIComponent(userId)}/notifications?page=${pageParam}&limit=${limit}`,
      ),
    initialPageParam: 1,
    getNextPageParam: nextParam,
    enabled: !!userId,
    // No poll: `notification` push messages invalidate this key live.
  });
}

export function useNotifications(userId: string) {
  return useInfiniteQuery(notificationsOptions(userId));
}

/** Mark one notification read — invalidates the list (badge + popover). */
export function useMarkNotificationRead(userId: string | null) {
  const qc = useQueryClient();
  const ensureJwt = useEnsureJwt();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!userId) throw new Error("Sign in to manage notifications");
      await ensureJwt();
      return api(
        `/social/${encodeURIComponent(userId)}/notifications/${encodeURIComponent(id)}/read`,
        { method: "POST" },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.notifications(userId ?? "") });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Mark every unread notification read ("clear all" / mark-all-read). */
export function useMarkAllNotificationsRead(userId: string | null) {
  const qc = useQueryClient();
  const ensureJwt = useEnsureJwt();
  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Sign in to manage notifications");
      await ensureJwt();
      return api(`/social/${encodeURIComponent(userId)}/notifications/read-all`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.notifications(userId ?? "") });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Mark one notification unread again — invalidates the list. */
export function useMarkNotificationUnread(userId: string | null) {
  const qc = useQueryClient();
  const ensureJwt = useEnsureJwt();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!userId) throw new Error("Sign in to manage notifications");
      await ensureJwt();
      return api(
        `/social/${encodeURIComponent(userId)}/notifications/${encodeURIComponent(id)}/unread`,
        { method: "POST" },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.notifications(userId ?? "") });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
