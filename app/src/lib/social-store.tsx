import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AuraAuthContext } from "@/lib/aura-auth";
import { useHandles } from "@/lib/handle-store";
import { useEnsureJwt } from "@/lib/jwt";
import { type FeedComment } from "@/lib/aura-feed";
import { handlesQueryOptions } from "@/queries/handles";
import { qk } from "@/queries/keys";
import { flatPages, useAllPages, type Page } from "@/queries/page";
import {
  bookmarksOptions,
  followingOptions,
  likesOptions,
  repostsOptions,
  subscriptionsOptions,
  useDeleteComment,
  useDeletePost,
  useToggleBookmark,
  useToggleFollow,
  useToggleLike,
  useToggleRepost,
  useToggleSubscribe,
} from "@/queries/social";

// ----------------------------------------------------------------------------
// Social state for the feed — follows, notification bells, likes, reposts,
// bookmarks and comments, all backed by the oracle API (query cache +
// invalidations). Handles are markets, not user accounts: you follow a @handle
// (its market). Keys resolve both "@name" and the subgraph handle id.
// ----------------------------------------------------------------------------

type SocialState = {
  /** Handles the signed-in user follows (indexed by id AND @name). */
  follows: Set<string>;
  /** Post/handle keys with notifications (the bell) on. */
  bells: Set<string>;
  /** Post ids the user liked. */
  likes: Set<string>;
  /** Post ids the user reposted (server list + session overrides). */
  reposts: Set<string>;
  /** Post ids the user bookmarked (server list + session overrides). */
  bookmarks: Set<string>;
  /** Extra comments written by the user, per post id (pending). */
  comments: Record<string, FeedComment[]>;
  isFollowing: (key: string) => boolean;
  toggleFollow: (key: string, name?: string) => void;
  isBelling: (key: string) => boolean;
  toggleBell: (postId: string, handleKey: string) => void;
  isLiked: (postId: string) => boolean;
  toggleLike: (postId: string) => void;
  isReposted: (postId: string) => boolean;
  toggleRepost: (postId: string) => void;
  isBookmarked: (postId: string) => boolean;
  toggleBookmark: (postId: string) => void;
  /** True when the signed-in user authored the post (`user:<addr>:…` id). */
  isOwnPost: (postId: string) => boolean;
  /** Delete one's own post (confirm first — backend cascades its rows). */
  deletePost: (postId: string) => void;
  /** Delete one's own comment. */
  deleteComment: (postId: string, commentId: string) => void;
  commentsFor: (postId: string) => FeedComment[];
  addComment: (postId: string, text: string) => void;
  /** Reply count including the user's own comments. */
  replyCount: (postId: string) => number;
  /** Replies the user added on top of the server's. */
  userReplies: (postId: string) => number;
};

const SocialCtx = createContext<SocialState | null>(null);

let commentSeq = 0;

export function SocialProvider({ children }: { children: ReactNode }) {
  const authCtx = useContext(AuraAuthContext);
  const userId = (authCtx?.auth.address ?? null)?.toLowerCase() ?? null;
  const qc = useQueryClient();
  const ensureJwt = useEnsureJwt();

  const { data: handles } = useQuery(handlesQueryOptions);
  const followIds = useAllPages(useInfiniteQuery(followingOptions(userId ?? "")));
  const subIds = useAllPages(useInfiniteQuery(subscriptionsOptions(userId ?? "")));
  const likeRows = useAllPages(useInfiniteQuery(likesOptions(userId ?? "")));
  const repostIds = useAllPages(useInfiniteQuery(repostsOptions(userId ?? "")));
  const bookmarkRows = useAllPages(useInfiniteQuery(bookmarksOptions(userId)));

  const followMut = useToggleFollow(userId);
  const subMut = useToggleSubscribe(userId);
  const likeMut = useToggleLike(userId);
  const repostMut = useToggleRepost(userId);
  const bookmarkMut = useToggleBookmark(userId);
  const deletePostMut = useDeletePost(userId);
  const deleteCommentMut = useDeleteComment(userId);

  /** Active handle (sidebar "You" chip) — used to sign comments. */
  const activeHandle = useHandles();
  const signedHandle = useMemo(() => {
    const list = activeHandle.handles;
    return list.find((h) => h.id === activeHandle.activeId) ?? list[0];
  }, [activeHandle]);

  /** Optimistic comments awaiting the server round-trip. */
  const [pending, setPending] = useState<Record<string, FeedComment[]>>({});
  /** Session toggles layered over the server lists for instant UI. */
  const [repostOverride, setRepostOverride] = useState<Record<string, boolean>>({});
  const [bookmarkOverride, setBookmarkOverride] = useState<Record<string, boolean>>({});
  /** postId → handleId for bells toggled from a post. */
  const [postBell, setPostBell] = useState<Record<string, string>>({});

  /** Server sets, indexed by id AND @name/@symbol for name-keyed lookups. */
  const follows = useMemo(() => {
    const set = new Set<string>();
    for (const id of followIds) {
      set.add(id);
      const h = handles?.find((x) => x.id === id);
      if (h?.name) set.add(`@${h.name.toLowerCase()}`);
      if (h?.symbol) set.add(`@${h.symbol.toLowerCase()}`);
    }
    return set;
  }, [followIds, handles]);

  const subs = useMemo(() => {
    const set = new Set<string>(subIds);
    for (const id of Object.values(postBell)) set.add(id);
    return set;
  }, [subIds, postBell]);

  const likes = useMemo(() => new Set<string>(likeRows.map((r) => r.targetId)), [likeRows]);

  const reposts = useMemo(() => {
    const set = new Set<string>(repostIds);
    for (const [id, on] of Object.entries(repostOverride)) {
      if (on) set.add(id);
      else set.delete(id);
    }
    return set;
  }, [repostIds, repostOverride]);

  const bookmarks = useMemo(() => {
    const set = new Set<string>(bookmarkRows.map((p) => p.id));
    for (const [id, on] of Object.entries(bookmarkOverride)) {
      if (on) set.add(id);
      else set.delete(id);
    }
    return set;
  }, [bookmarkRows, bookmarkOverride]);

  /** name/@name/id → canonical handle id. */
  const resolveId = useCallback(
    (key: string): string => {
      const bare = key.replace(/^@/, "").toLowerCase();
      const hit = handles?.find(
        (h) =>
          h.id.toLowerCase() === key.toLowerCase() ||
          (h.name ?? "").toLowerCase() === bare ||
          (h.symbol ?? "").toLowerCase() === bare,
      );
      return hit?.id ?? key;
    },
    [handles],
  );

  const toggleFollow = useCallback(
    (key: string, name?: string) => {
      if (!userId) {
        toast.info("Connect a wallet to follow handles");
        void authCtx?.login();
        return;
      }
      const handleId = resolveId(key);
      const label = name ?? (key.startsWith("@") ? key : `@${key}`);
      const following = follows.has(handleId) || follows.has(key);
      followMut.mutate(
        { handleId, follow: !following, name: label },
        {
          onSuccess: () =>
            toast(following ? `Unfollowed ${label}` : `Following ${label}`, {
              description: following
                ? "You'll see fewer posts from this handle."
                : "Feed posts and window alerts are on.",
            }),
        },
      );
    },
    [resolveId, userId, followMut, follows],
  );

  const toggleBell = useCallback(
    (postId: string, handleKey: string) => {
      if (!userId) {
        toast.info("Connect a wallet to get alerts");
        void authCtx?.login();
        return;
      }
      const handleId = resolveId(handleKey);
      const subscribed = subs.has(handleId);
      subMut.mutate(
        { handleId, subscribe: !subscribed },
        {
          onSuccess: () => {
            setPostBell((prev) => {
              const next = { ...prev };
              if (subscribed) delete next[postId];
              else next[postId] = handleId;
              return next;
            });
            toast(
              subscribed
                ? `Notifications off for ${handleKey}`
                : `Notifications on for ${handleKey}`,
              {
                description: subscribed
                  ? "Post alerts muted."
                  : "You'll be notified when this handle posts.",
              },
            );
          },
        },
      );
    },
    [resolveId, userId, subMut, subs],
  );

  const toggleLike = useCallback(
    (postId: string) => {
      if (!userId) {
        toast.info("Connect a wallet to like posts");
        void authCtx?.login();
        return;
      }
      likeMut.mutate({ targetId: postId, like: !likes.has(postId) });
    },
    [userId, likeMut, likes],
  );

  const toggleRepost = useCallback(
    (postId: string) => {
      if (!userId) {
        toast.info("Connect a wallet to repost");
        void authCtx?.login();
        return;
      }
      const reposted = reposts.has(postId);
      repostMut.mutate(
        { eventId: postId, repost: !reposted },
        {
          onSuccess: () => {
            setRepostOverride((prev) => ({ ...prev, [postId]: !reposted }));
            toast(reposted ? "Repost removed" : "Reposted", {
              description: reposted ? undefined : "Shared to your profile.",
            });
          },
        },
      );
    },
    [userId, repostMut, reposts],
  );

  const toggleBookmark = useCallback(
    (postId: string) => {
      if (!userId) {
        toast.info("Connect a wallet to save posts");
        void authCtx?.login();
        return;
      }
      const saved = bookmarks.has(postId);
      bookmarkMut.mutate(
        { postId, bookmark: !saved },
        {
          onSuccess: () => {
            setBookmarkOverride((prev) => ({ ...prev, [postId]: !saved }));
            toast(saved ? "Removed from Saved" : "Saved", {
              description: saved ? undefined : "Find it under Saved.",
            });
          },
        },
      );
    },
    [userId, bookmarkMut, bookmarks],
  );

  const isOwnPost = useCallback(
    (postId: string): boolean => {
      if (!userId) return false;
      const parts = postId.split(":");
      return parts[0] === "user" && (parts[1] ?? "").toLowerCase() === userId;
    },
    [userId],
  );

  const runDeletePost = useCallback(
    (postId: string) => {
      if (!userId) {
        toast.info("Connect a wallet to delete posts");
        void authCtx?.login();
        return;
      }
      deletePostMut.mutate({ postId }, { onSuccess: () => toast("Post deleted") });
    },
    [userId, deletePostMut],
  );

  const runDeleteComment = useCallback(
    (postId: string, commentId: string) => {
      if (!userId) {
        toast.info("Connect a wallet to delete comments");
        void authCtx?.login();
        return;
      }
      deleteCommentMut.mutate({ postId, commentId }, { onSuccess: () => toast("Reply deleted") });
    },
    [userId, deleteCommentMut],
  );

  const addComment = useCallback(
    (postId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!userId) {
        toast.info("Connect a wallet to reply");
        void authCtx?.login();
        return;
      }
      commentSeq += 1;
      const short = `${userId.slice(0, 6)}…${userId.slice(-4)}`;
      const displayName = signedHandle?.name ?? short;
      const handleStr = signedHandle
        ? `@${(signedHandle.symbol || signedHandle.name).toLowerCase()}`
        : short;
      const optimistic: FeedComment = {
        id: `you-${commentSeq}`,
        user: displayName,
        handle: short,
        color: "hsl(var(--primary))",
        text: trimmed,
        ts: "now",
        mine: true,
      };
      setPending((prev) => ({ ...prev, [postId]: [...(prev[postId] ?? []), optimistic] }));
      void (async () => {
        try {
          await ensureJwt();
          await api(`/social/posts/${encodeURIComponent(postId)}/comments`, {
            method: "POST",
            json: { user: userId, handle: handleStr, text: trimmed },
          });
          setPending((prev) => ({
            ...prev,
            [postId]: (prev[postId] ?? []).filter((c) => c.id !== optimistic.id),
          }));
          void qc.invalidateQueries({ queryKey: qk.comments(postId) });
          void qc.invalidateQueries({ queryKey: qk.post(postId) });
          void qc.invalidateQueries({ queryKey: ["posts"] });
          toast("Reply posted");
        } catch (e) {
          setPending((prev) => ({
            ...prev,
            [postId]: (prev[postId] ?? []).filter((c) => c.id !== optimistic.id),
          }));
          toast.error(e instanceof Error ? e.message : "Reply failed");
        }
      })();
    },
    [ensureJwt, qc, userId, signedHandle],
  );

  const value = useMemo<SocialState>(() => {
    const baseComments = (postId: string) =>
      flatPages(
        qc.getQueryData<InfiniteData<Page<FeedComment>, number>>(
          qk.comments(postId, userId ?? undefined),
        )?.pages,
      );

    return {
      follows,
      bells: subs,
      likes,
      reposts,
      bookmarks,
      comments: pending,
      isFollowing: (key) => follows.has(key) || follows.has(resolveId(key)),
      toggleFollow,
      isBelling: (key) => subs.has(key) || (postBell[key] ? subs.has(postBell[key]!) : false),
      toggleBell,
      isLiked: (postId) => likes.has(postId),
      toggleLike,
      isReposted: (postId) => reposts.has(postId),
      toggleRepost,
      isBookmarked: (postId) => bookmarks.has(postId),
      toggleBookmark,
      isOwnPost,
      deletePost: runDeletePost,
      deleteComment: runDeleteComment,
      commentsFor: (postId) => [...baseComments(postId), ...(pending[postId] ?? [])],
      addComment,
      replyCount: (postId) => baseComments(postId).length + (pending[postId]?.length ?? 0),
      userReplies: (postId) => pending[postId]?.length ?? 0,
    };
  }, [
    follows,
    subs,
    likes,
    reposts,
    bookmarks,
    pending,
    postBell,
    qc,
    userId,
    resolveId,
    toggleFollow,
    toggleBell,
    toggleLike,
    toggleRepost,
    toggleBookmark,
    isOwnPost,
    runDeletePost,
    runDeleteComment,
    addComment,
  ]);

  return <SocialCtx.Provider value={value}>{children}</SocialCtx.Provider>;
}

export function useSocial(): SocialState {
  const ctx = useContext(SocialCtx);
  if (!ctx) throw new Error("useSocial must be used within a SocialProvider");
  return ctx;
}
