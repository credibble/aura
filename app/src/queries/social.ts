/**
 * Social graph mutations — follow / subscribe / like / repost / bookmark
 * against the oracle API (wallet-JWT guarded). Every mutation invalidates ALL
 * read surfaces that show its effect (timeline, profile, counts, state lists).
 */
import { infiniteQueryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useEnsureJwt } from "@/lib/jwt";
import { bumpEngagement, type PostEvent } from "./posts";
import { nextParam, type Page } from "./page";
import { qk } from "./keys";

function invalidate(
  qc: ReturnType<typeof useQueryClient>,
  keys: readonly (readonly unknown[])[],
): void {
  for (const key of keys) void qc.invalidateQueries({ queryKey: key as unknown[] });
}

export function followingOptions(userId: string) {
  return infiniteQueryOptions({
    queryKey: qk.following(userId),
    queryFn: ({ pageParam }) =>
      api<Page<string>>(
        `/social/${encodeURIComponent(userId)}/following?page=${pageParam}&limit=100`,
      ),
    initialPageParam: 1,
    getNextPageParam: nextParam,
    enabled: !!userId,
  });
}

export function subscriptionsOptions(userId: string) {
  return infiniteQueryOptions({
    queryKey: qk.subscriptions(userId),
    queryFn: ({ pageParam }) =>
      api<Page<string>>(
        `/social/${encodeURIComponent(userId)}/subscriptions?page=${pageParam}&limit=100`,
      ),
    initialPageParam: 1,
    getNextPageParam: nextParam,
    enabled: !!userId,
  });
}

export function likesOptions(userId: string) {
  return infiniteQueryOptions({
    queryKey: qk.likes(userId),
    queryFn: ({ pageParam }) =>
      api<Page<{ targetId: string; targetType: string }>>(
        `/social/${encodeURIComponent(userId)}/likes?page=${pageParam}&limit=100`,
      ),
    initialPageParam: 1,
    getNextPageParam: nextParam,
    enabled: !!userId,
  });
}

/** The user's reposted post ids — hydrates the feed's repost state. */
export function repostsOptions(userId: string) {
  return infiniteQueryOptions({
    queryKey: qk.reposts(userId),
    queryFn: ({ pageParam }) =>
      api<Page<string>>(
        `/social/${encodeURIComponent(userId)}/reposts?page=${pageParam}&limit=100`,
      ),
    initialPageParam: 1,
    getNextPageParam: nextParam,
    enabled: !!userId,
  });
}

/** The user's bookmarked (saved) posts — viewer via `?currentUser=`. */
export function bookmarksOptions(userId: string | null) {
  return infiniteQueryOptions({
    queryKey: qk.bookmarks(userId ?? ""),
    queryFn: ({ pageParam }) =>
      api<Page<PostEvent>>(
        `/social/bookmarks?currentUser=${encodeURIComponent(userId!)}&page=${pageParam}&limit=100`,
      ),
    initialPageParam: 1,
    getNextPageParam: nextParam,
    enabled: !!userId,
  });
}

/** The user's reposted posts (the /saved Reposts tab) — viewer via `?currentUser=`. */
export function repostedPostsOptions(userId: string | null) {
  return infiniteQueryOptions({
    queryKey: qk.reposted(userId ?? ""),
    queryFn: ({ pageParam }) =>
      api<Page<PostEvent>>(
        `/social/reposted?currentUser=${encodeURIComponent(userId!)}&page=${pageParam}&limit=20`,
      ),
    initialPageParam: 1,
    getNextPageParam: nextParam,
    enabled: !!userId,
  });
}

export function followersOptions(handleId: string) {
  return infiniteQueryOptions({
    queryKey: qk.followers(handleId),
    queryFn: ({ pageParam }) =>
      api<Page<string>>(
        `/social/${encodeURIComponent(handleId)}/followers?page=${pageParam}&limit=100`,
      ),
    initialPageParam: 1,
    getNextPageParam: nextParam,
    enabled: !!handleId,
  });
}

export function useToggleFollow(userId: string | null) {
  const qc = useQueryClient();
  const ensureJwt = useEnsureJwt();
  return useMutation({
    mutationFn: async ({
      handleId,
      follow,
    }: {
      handleId: string;
      follow: boolean;
      name?: string;
    }) => {
      if (!userId) throw new Error("Sign in to follow handles");
      await ensureJwt();
      return follow
        ? api(`/social/follow`, { method: "POST", json: { userId, handleId } })
        : api(`/social/follow`, { method: "DELETE", json: { userId, handleId } });
    },
    onSuccess: (_d, v) => {
      invalidate(qc, [qk.following(userId ?? ""), qk.followers(v.handleId), ["feed"], ["posts"]]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useToggleSubscribe(userId: string | null) {
  const qc = useQueryClient();
  const ensureJwt = useEnsureJwt();
  return useMutation({
    mutationFn: async ({ handleId, subscribe }: { handleId: string; subscribe: boolean }) => {
      if (!userId) throw new Error("Sign in to subscribe");
      await ensureJwt();
      return subscribe
        ? api(`/social/subscribe`, { method: "POST", json: { userId, handleId } })
        : api(`/social/subscribe`, { method: "DELETE", json: { userId, handleId } });
    },
    onSuccess: (_d, v) => {
      invalidate(qc, [qk.subscriptions(userId ?? ""), ["feed"]]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useToggleLike(userId: string | null) {
  const qc = useQueryClient();
  const ensureJwt = useEnsureJwt();
  return useMutation({
    mutationFn: async ({ targetId, like }: { targetId: string; like: boolean }) => {
      if (!userId) throw new Error("Sign in to like posts");
      await ensureJwt();
      return like
        ? api(`/social/like`, { method: "POST", json: { userId, targetId, targetType: "feed" } })
        : api(`/social/like`, { method: "DELETE", json: { userId, targetId, targetType: "feed" } });
    },
    // Optimistic ±1 so the tap feels instant; the invalidation below replaces it
    // with the server's count (previously the render added +1 permanently, which
    // made one like read as two once the refetch/WS patch landed).
    onMutate: ({ targetId, like }) => bumpEngagement(qc, targetId, "likes", like ? 1 : -1),
    onError: (e: Error, v) => {
      bumpEngagement(qc, v.targetId, "likes", v.like ? -1 : 1);
      toast.error(e.message);
    },
    onSuccess: (_d, v) => {
      invalidate(qc, [qk.likes(userId ?? ""), ["posts"], ["post", v.targetId], ["feed"]]);
    },
  });
}

export function useToggleRepost(userId: string | null) {
  const qc = useQueryClient();
  const ensureJwt = useEnsureJwt();
  return useMutation({
    mutationFn: async ({ eventId, repost }: { eventId: string; repost: boolean }) => {
      if (!userId) throw new Error("Sign in to repost");
      await ensureJwt();
      return repost
        ? api(`/social/repost`, { method: "POST", json: { userId, eventId } })
        : api(`/social/repost`, { method: "DELETE", json: { userId, eventId } });
    },
    // Optimistic ±1 (same reasoning as likes) — the server count wins on invalidate.
    onMutate: ({ eventId, repost }) => bumpEngagement(qc, eventId, "reposts", repost ? 1 : -1),
    onError: (e: Error, v) => {
      bumpEngagement(qc, v.eventId, "reposts", v.repost ? -1 : 1);
      toast.error(e.message);
    },
    onSuccess: (_d, v) => {
      invalidate(qc, [
        qk.reposts(userId ?? ""),
        qk.reposted(userId ?? ""),
        ["feed"],
        ["posts"],
        ["post", v.eventId],
      ]);
    },
  });
}

/** Bookmark (save) a post — invalidates the Saved list + post surfaces. */
export function useToggleBookmark(userId: string | null) {
  const qc = useQueryClient();
  const ensureJwt = useEnsureJwt();
  return useMutation({
    mutationFn: async ({ postId, bookmark }: { postId: string; bookmark: boolean }) => {
      if (!userId) throw new Error("Sign in to bookmark posts");
      await ensureJwt();
      return bookmark
        ? api(`/social/${encodeURIComponent(userId)}/bookmarks`, {
            method: "POST",
            json: { postId },
          })
        : api(`/social/${encodeURIComponent(userId)}/bookmarks`, {
            method: "DELETE",
            json: { postId },
          });
    },
    onSuccess: (_d, v) => {
      invalidate(qc, [qk.bookmarks(userId ?? ""), ["posts"], ["feed"], ["post", v.postId]]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Delete the caller's own post — the backend cascades comments/reposts/
 *  bookmarks and clears feed-likes; the actor comes from the JWT. */
export function useDeletePost(userId: string | null) {
  const qc = useQueryClient();
  const ensureJwt = useEnsureJwt();
  return useMutation({
    mutationFn: async ({ postId }: { postId: string }) => {
      if (!userId) throw new Error("Sign in to delete posts");
      await ensureJwt();
      return api(`/social/posts/${encodeURIComponent(postId)}`, { method: "DELETE" });
    },
    onSuccess: (_d, v) => {
      invalidate(qc, [
        ["posts"],
        ["feed"],
        ["search"],
        ["bookmarks"],
        ["reposts"],
        ["post", v.postId],
        ["comments", v.postId],
      ]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Delete the caller's own comment — pushes the post's fresh reply count. */
export function useDeleteComment(userId: string | null) {
  const qc = useQueryClient();
  const ensureJwt = useEnsureJwt();
  return useMutation({
    mutationFn: async ({ postId, commentId }: { postId: string; commentId: string }) => {
      if (!userId) throw new Error("Sign in to delete comments");
      await ensureJwt();
      return api(`/social/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
    },
    onSuccess: (_d, v) => {
      invalidate(qc, [["comments", v.postId], ["post", v.postId], ["posts"], ["feed"]]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
