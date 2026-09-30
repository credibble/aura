/**
 * Post queries/mutations — backend-owned data (the oracle Post table).
 * GET posts are cached; mutations invalidate every surface they affect
 * (timeline, profile, post detail, comments, counts).
 */
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { api, getJwt } from "@/lib/api";
import { useEnsureJwt } from "@/lib/jwt";
import { API_BASE } from "@/lib/privy";
import { timeAgo } from "@/lib/format";
import type { FeedComment, FeedPost, FeedSource } from "@/lib/aura-feed";
import { categoryFromCode } from "./handles";
import { qk } from "./keys";
import { nextParam, type Page } from "./page";

export type CommentView = {
  id: string;
  user: string;
  handle: string;
  text: string;
  /** Attached reaction GIF (/gifs/… or an https URL). */
  media?: string | null;
  ts: number;
  /** Present when `?currentUser=` matched the comment's author. */
  mine?: boolean;
};

// The oracle's post payload (POST /social/posts responses) — no attached aura.
// `*ByMe` flags are attached only when `?currentUser=` is passed.
export type PostEvent = {
  id: string;
  assetId: string;
  kind: string;
  title: string;
  body: string;
  ts: number;
  change: number;
  handle: string;
  name: string;
  category: string;
  marketId: string;
  ai: boolean;
  createdAt: number;
  likedByMe?: boolean;
  repostedByMe?: boolean;
  bookmarkedByMe?: boolean;
  media: { kind: "image" | "video"; src: string; alt?: string }[];
  sources: {
    id: string;
    platform: string;
    account: string;
    text: string;
    ts: number;
    aura: number;
    stats?: string;
  }[];
  stats: { replies: number; reposts: number; likes: number; views: number };
};

function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function dateLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Backend PostEvent → the timeline's FeedPost. */
export function toFeedPost(p: PostEvent): FeedPost {
  const sources: FeedSource[] = (p.sources ?? []).map((s) => ({
    id: s.id,
    platform: (s.platform as FeedSource["platform"]) ?? "news",
    account: s.account,
    text: s.text,
    ts: timeAgo(s.ts),
    aura: s.aura,
    stats: s.stats,
  }));
  const media: FeedPost["media"] = (p.media ?? []).map((m) =>
    m.kind === "video"
      ? { kind: "video" as const, src: m.src, alt: m.alt ?? "" }
      : { kind: "image" as const, src: m.src, alt: m.alt ?? "" },
  );
  return {
    id: p.id,
    marketId: p.marketId,
    handle: p.handle,
    name: p.name,
    assetId: p.assetId,
    category: categoryFromCode(p.category),
    ts: timeAgo(p.createdAt),
    time: clockTime(p.createdAt),
    date: dateLabel(p.createdAt),
    summary: p.title,
    body: p.body.split("\n").filter(Boolean),
    createdAt: p.createdAt,
    media,
    stats: p.stats ?? { replies: 0, reposts: 0, likes: 0, views: 0 },
    sources,
  };
}

/** Every backend post (optionally one handle), newest first — infinite pages. */
export function postsOptions(handleId?: string, limit = 30) {
  return infiniteQueryOptions({
    queryKey: qk.posts(handleId ?? "all"),
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ page: String(pageParam), limit: String(limit) });
      if (handleId) qs.set("handleId", handleId);
      const data = await api<Page<PostEvent>>(`/social/posts?${qs}`);
      return { items: data.items.map(toFeedPost), meta: data.meta };
    },
    initialPageParam: 1,
    getNextPageParam: nextParam,
    staleTime: 10_000,
    // No poll: `feed` push messages invalidate new posts live.
  });
}

/** Full-text post search (`?q=` over summary/handle/name) — infinite pages. */
export function postsSearchOptions(q: string, limit = 15) {
  const needle = q.trim();
  return infiniteQueryOptions({
    queryKey: qk.search(needle.toLowerCase()),
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({
        q: needle,
        page: String(pageParam),
        limit: String(limit),
      });
      const data = await api<Page<PostEvent>>(`/social/posts?${qs}`);
      return { items: data.items.map(toFeedPost), meta: data.meta };
    },
    initialPageParam: 1,
    getNextPageParam: nextParam,
    enabled: !!needle,
    staleTime: 10_000,
  });
}

export function postOptions(id: string) {
  return queryOptions({
    queryKey: qk.post(id),
    queryFn: async () =>
      toFeedPost(await api<PostEvent>(`/social/posts/${encodeURIComponent(id)}`)),
    enabled: !!id,
  });
}

/** FeedPost counters a tap can change optimistically. */
type EngagementKey = "likes" | "reposts";

/**
 * Apply an OPTIMISTIC ±1 to a post's engagement counter wherever it is cached —
 * every infinite feed the post appears in, plus the single-post cache.
 *
 * Why this exists: the UI used to fake the number at render time (`likes + (liked
 * ? 1 : 0)`), which double-counted the moment the refetch or the `social.engagement`
 * WS patch landed — one like showed as two. The count now has ONE source of
 * truth (the cached post), this only moves it early, and the mutation's
 * invalidation overwrites it with the server's truth.
 */
export function bumpEngagement(
  qc: QueryClient,
  postId: string,
  key: EngagementKey,
  delta: number,
): void {
  const bump = (post: FeedPost | undefined | null): FeedPost | undefined | null =>
    post && post.id === postId
      ? { ...post, stats: { ...post.stats, [key]: Math.max(0, (post.stats[key] ?? 0) + delta) } }
      : post;

  for (const prefix of [["feed"], ["posts"], ["search"], ["bookmarks"]]) {
    qc.setQueriesData({ queryKey: prefix }, (data: unknown) => {
      const pages = (data as { pages?: { items?: FeedPost[] }[] } | undefined)?.pages;
      if (!Array.isArray(pages)) return data;
      let touched = false;
      const next = pages.map((page) => {
        if (!Array.isArray(page?.items)) return page;
        const items = page.items.map((item) => {
          const bumped = bump(item);
          if (bumped !== item) touched = true;
          return (bumped ?? item) as FeedPost;
        });
        return { ...page, items };
      });
      return touched ? { ...(data as object), pages: next } : data;
    });
  }
  qc.setQueryData(qk.post(postId), (post: unknown) => bump(post as FeedPost | undefined));
}

/** The signed-in user's following feed — filtered SERVER-side (followed /
 *  subscribed handles + own reposts), newest first, infinite pages. */
export function feedOptions(userId: string | null, limit = 30) {
  return infiniteQueryOptions({
    queryKey: qk.feed(userId ?? ""),
    queryFn: async ({ pageParam }) => {
      const data = await api<Page<PostEvent>>(
        `/social/${encodeURIComponent(userId!)}/feed?page=${pageParam}&limit=${limit}`,
      );
      return { items: data.items.map(toFeedPost), meta: data.meta };
    },
    initialPageParam: 1,
    getNextPageParam: nextParam,
    enabled: !!userId,
    staleTime: 10_000,
    // No poll: `feed` push messages invalidate new posts live.
  });
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** `0x1234…abcd` for addresses, verbatim for anything else. */
function shortUser(u: string): string {
  return ADDRESS_RE.test(u) ? `${u.slice(0, 6)}…${u.slice(-4)}` : u;
}

function toFeedComment(c: CommentView, viewer?: string | null): FeedComment {
  let h = 2166136261;
  for (let i = 0; i < c.user.length; i++) h = Math.imul(h ^ c.user.charCodeAt(i), 16777619);
  const hue = (h >>> 0) % 360;
  const short = shortUser(c.user);
  const name = c.handle && c.handle !== "@you" ? c.handle.replace(/^@/, "") : short;
  return {
    id: c.id,
    user: name,
    handle: short,
    color: `hsl(${hue} 65% 45%)`,
    text: c.text,
    media: c.media ?? null,
    ts: timeAgo(c.ts),
    mine: !!viewer && !!c.user && c.user.toLowerCase() === viewer.toLowerCase(),
  };
}

/** Replies on a post, oldest first — infinite pages (viewer → `mine` flags). */
export function commentsOptions(postId: string, viewer?: string | null, limit = 50) {
  return infiniteQueryOptions({
    queryKey: qk.comments(postId, viewer ?? undefined),
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ page: String(pageParam), limit: String(limit) });
      if (viewer) qs.set("currentUser", viewer);
      const data = await api<Page<CommentView>>(
        `/social/posts/${encodeURIComponent(postId)}/comments?${qs}`,
      );
      return { items: data.items.map((c) => toFeedComment(c, viewer)), meta: data.meta };
    },
    initialPageParam: 1,
    getNextPageParam: nextParam,
    enabled: !!postId,
  });
}

export function usePosts(handleId?: string) {
  return useInfiniteQuery(postsOptions(handleId));
}

export function useFeed(userId: string | null) {
  return useInfiniteQuery(feedOptions(userId));
}

export function usePost(id: string | undefined) {
  return useQuery({ ...postOptions(id ?? ""), enabled: !!id });
}

export function useComments(postId: string | undefined, viewer?: string | null) {
  return useInfiniteQuery(commentsOptions(postId ?? "", viewer));
}

/** Post ids already counted in this session — one view per post per session. */
const viewedPosts = new Set<string>();

/** Count a post detail open once per session (fire-and-forget). */
export function useViewPost(postId: string | undefined): void {
  useEffect(() => {
    if (!postId || viewedPosts.has(postId)) return;
    viewedPosts.add(postId);
    void api(`/social/posts/${encodeURIComponent(postId)}/view`, { method: "POST" }).catch(
      () => undefined,
    );
  }, [postId]);
}

/** Add a reply — invalidates comments + the post's reply count. */
export function useAddComment(postId: string | undefined) {
  const qc = useQueryClient();
  const ensureJwt = useEnsureJwt();
  return useMutation({
    mutationFn: async ({
      user,
      handle,
      text,
      media,
    }: {
      user: string;
      handle: string;
      text: string;
      media?: string | null;
    }) => {
      await ensureJwt();
      return api<CommentView>(`/social/posts/${encodeURIComponent(postId!)}/comments`, {
        method: "POST",
        json: { user, handle, text, ...(media ? { media } : {}) },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.comments(postId ?? "") });
      void qc.invalidateQueries({ queryKey: qk.post(postId ?? "") });
      void qc.invalidateQueries({ queryKey: ["posts"] });
      toast("Reply posted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Create a user post (text + optional files) — invalidates every timeline. */
export function useCreatePost() {
  const qc = useQueryClient();
  const ensureJwt = useEnsureJwt();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      handleId: string;
      handle: string;
      name: string;
      category: string;
      marketId: string;
      summary: string;
      bodyText: string;
      files?: File[];
    }) => {
      await ensureJwt();
      const form = new FormData();
      for (const [k, v] of Object.entries(input)) {
        if (k === "files") continue;
        form.append(k, String(v));
      }
      for (const f of input.files ?? []) form.append("files", f);
      const token = getJwt();
      const res = await fetch(`${API_BASE}/social/posts`, {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) throw new Error(`create post failed: ${res.status}`);
      const json = (await res.json()) as { data: PostEvent };
      return toFeedPost(json.data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["posts"] });
      void qc.invalidateQueries({ queryKey: ["feed"] });
      toast("Posted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
