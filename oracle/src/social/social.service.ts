import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../persistence/prisma.service";
import { OracleEventBus } from "../orchestration/oracle-event-bus.service";
import { OutboxService } from "../orchestration/outbox.service";
import type { OnChainHandleView } from "../core/domain/handle";
import type { FeedEvent, SocialEventData } from "@aura/contracts";
import { IndexerHandleSync } from "../registry/indexer-handle-sync.service";
import { ChainGateway } from "../jobs/chain/chain-gateway.service";

export type LikeTargetType = "feed" | "window" | "handle";

/** Full frontend post shape: FeedEvent + Post fields. Posts never carry an
 *  attached aura snapshot — the indexer owns the aura series. */
export interface PostEvent extends FeedEvent {
  handle: string;
  name: string;
  category: string;
  marketId: string;
  ai: boolean;
  createdAt: number;
  /** FeedMedia[] â€” images/videos picked from the analysed sources (or uploaded). */
  media: { kind: "image" | "video"; src: string; alt?: string }[];
  /** FeedSource[] â€” the underlying source posts that fed the aggregate. */
  sources: { id: string; platform: string; account: string; text: string; ts: number; aura: number; stats?: string }[];
  /** Denormalized counters (Comment / Like / Repost tables). */
  stats: { replies: number; reposts: number; likes: number; views: number };
  /** Viewer flags â€” only set when the request carries `?currentUser=0xâ€¦`. */
  likedByMe?: boolean;
  repostedByMe?: boolean;
  bookmarkedByMe?: boolean;
}

/** The Prisma Post columns the mapper needs (model satisfies this structurally). */
type PostRow = {
  id: string;
  handleId: string;
  handle: string;
  name: string;
  category: string;
  kind: string;
  marketId: string;
  summary: string;
  body: unknown;
  media: unknown;
  sources: unknown;
  replies: number;
  reposts: number;
  likes: number;
  views: number;
  ai: boolean;
  ts: Date;
  createdAt: Date;
};

/**
 * Social layer: follows, likes, subscriptions, notifications and reposting.
 * Users follow/subscribe to handles (and claim handles on the portfolio page),
 * like feed items, and repost them; subscribers are notified when a window
 * they follow resolves or a shock hits. Postgres-backed with a local fallback
 * for dev/tests.
 */
@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly bus?: OracleEventBus,
    /** On-chain handle registry — owner resolution for follow notifications
     *  (IndexerHandleSync; omitted in unit tests). @Inject gives Nest a real
     *  class token — the structural type alone would emit `Object` as the
     *  paramtype and fail DI; the field stays structural for easy stubs. */
    @Optional()
    @Inject(IndexerHandleSync)
    private readonly indexer?: { handles(): Promise<OnChainHandleView[]> },
    /** On-chain metadata writer (Handle.setMetadata) â€” the relayer/auraUpdater.
     *  Optional so unit tests can omit the chain entirely. */
    @Optional()
    private readonly chain?: ChainGateway,
    /** Durable publish path (outbox â†’ bus â†’ stream). Optional for tests. */
    @Optional()
    private readonly outbox?: OutboxService,
  ) {}

  /** Ensure a User row exists for the wallet address (FK target). */
  private async ensureUser(userId: string): Promise<void> {    try {
      await this.prisma.user.upsert({
        where: { id: userId },
        create: { id: userId },
        update: {},
      });
    } catch {
      /* Postgres down â€” local fallback handles it */
    }
  }

  /**
   * A database failure must not masquerade as "no data".
   *
   * When the DB is required (production) the error is rethrown as 503 so clients
   * and alerts see it; only in explicitly-optional mode (dev/tests) does the
   * caller's empty fallback apply. Every read path below routes its catch here.
   */
  private dbFallback<T>(op: string, fallback: T, error: unknown): T {
    const message = `${op} failed: ${(error as Error).message}`;
    if (this.prisma.required) {
      this.logger.error(message);
      throw new ServiceUnavailableException(`${op} is temporarily unavailable`);
    }
    this.logger.warn(`${message} (degraded to empty)`);
    return fallback;
  }

  /** Broadcast a social-layer change (post/comment/engagement) to all clients.
   *  Goes through the outbox so the event survives a crash between the write and
   *  the push; the bus still delivers it immediately in the happy path. */
  private publishSocial(data: SocialEventData): void {
    if (this.outbox) {
      this.outbox.emit("social", data);
      return;
    }
    this.bus?.publish({
      v: 1,
      source: "oracle",
      type: "social",
      ts: Date.now(),
      seq: 0,
      data,
    });
  }

  /** Increment/decrement a denormalized Post counter, then push the fresh
   *  stats. Silent no-op when the id is not a Post row (or PG is down). */
  private async bumpPostCounter(
    id: string,
    field: "likes" | "reposts" | "replies",
    by: 1 | -1,
  ): Promise<void> {
    try {
      const data =
        field === "likes"
          ? { likes: { increment: by } }
          : field === "reposts"
            ? { reposts: { increment: by } }
            : { replies: { increment: by } };
      const row = await this.prisma.post.update({ where: { id }, data });
      this.publishSocial({
        op: "engagement",
        postId: id,
        stats: { likes: row.likes, reposts: row.reposts, replies: row.replies },
      });
    } catch {
      /* not a Post row (or Postgres down) â€” no live counter to push */
    }
  }

  /** Map a Prisma post row to the frontend shape (no aura attached). */
  private toPost(p: PostRow): PostEvent {
    return {
      id: p.id,
      assetId: p.handleId,
      kind: p.kind as FeedEvent["kind"],
      title: p.summary,
      body: (p.body as string[]).join("\n"),
      ts: p.ts.getTime(),
      change: 0,
      handle: p.handle,
      name: p.name,
      category: p.category,
      marketId: p.marketId,
      ai: p.ai,
      createdAt: p.createdAt.getTime(),
      media: (p.media as PostEvent["media"]) ?? [],
      sources: (p.sources as PostEvent["sources"]) ?? [],
      stats: { replies: p.replies, reposts: p.reposts, likes: p.likes, views: p.views },
    };
  }

  /** Attach the viewer's liked/reposted/bookmarked flags to a page of posts
   *  (batched â€” 3 queries per page, local-set fallback when Postgres is down). */
  private async decorate(
    items: PostEvent[],
    viewer: string | null,
  ): Promise<PostEvent[]> {
    if (!viewer || items.length === 0) return items;
    const ids = items.map((p) => p.id);
    try {
      const [likes, reposts, marks] = await Promise.all([
        this.prisma.like.findMany({
          where: { userId: viewer, targetId: { in: ids }, targetType: "feed" },
          select: { targetId: true },
        }),
        this.prisma.repost.findMany({
          where: { userId: viewer, eventId: { in: ids } },
          select: { eventId: true },
        }),
        this.prisma.bookmark.findMany({
          where: { userId: viewer, postId: { in: ids } },
          select: { postId: true },
        }),
      ]);
      const liked = new Set(likes.map((r) => r.targetId));
      const reposted = new Set(reposts.map((r) => r.eventId));
      const marked = new Set(marks.map((r) => r.postId));
      return items.map((p) => ({
        ...p,
        likedByMe: liked.has(p.id),
        repostedByMe: reposted.has(p.id),
        bookmarkedByMe: marked.has(p.id),
      }));
    } catch {
      return items.map((p) => ({
        ...p,
        likedByMe: this.localLikes.has(likeKey(viewer, p.id, "feed")),
        repostedByMe: this.localReposts.has(repostKey(viewer, p.id)),
        bookmarkedByMe: this.localBookmarks.has(bookmarkKey(viewer, p.id)),
      }));
    }
  }

  /** Latest AI posts across all handles (global feed), paginated. `q` searches
   *  summary/handle/name (case-insensitive); `viewer` adds the ByMe flags. */
  async latestPosts(
    page: number,
    limit: number,
    handleId?: string,
    viewer?: string | null,
    q?: string,
  ): Promise<{ items: PostEvent[]; total: number }> {
    const where = {
      ...(handleId ? { handleId } : {}),
      ...(q
        ? {
            OR: [
              { summary: { contains: q, mode: "insensitive" as const } },
              { handle: { contains: q, mode: "insensitive" as const } },
              { name: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        orderBy: { ts: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.post.count({ where }),
    ]);
    return {
      items: await this.decorate(rows.map((p) => this.toPost(p)), viewer ?? null),
      total,
    };
  }

  /** One AI post by id (detail page). */
  async post(id: string, viewer?: string | null): Promise<PostEvent | null> {
    const p = await this.prisma.post.findUnique({ where: { id } });
    if (!p) return null;
    const [item] = await this.decorate([this.toPost(p)], viewer ?? null);
    return item!;
  }

  // --- comments ---------------------------------------------------------------

  /** Comments on a post (detail page replies), paginated. `viewer` marks the
   *  caller's own comments with `mine`. */
  async comments(
    postId: string,
    page: number,
    limit: number,
    viewer?: string | null,
  ): Promise<{
    items: {
      id: string;
      user: string;
      handle: string;
      text: string;
      media: string | null;
      ts: number;
      mine?: boolean;
    }[];
    total: number;
  }> {
    try {
      const [rows, total] = await Promise.all([
        this.prisma.comment.findMany({
          where: { postId },
          orderBy: { createdAt: "asc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.comment.count({ where: { postId } }),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          user: r.userId ?? "",
          handle: r.handle,
          text: r.text,
          media: r.media,
          ts: r.createdAt.getTime(),
          ...(viewer && r.userId ? { mine: r.userId === viewer } : {}),
        })),
        total,
      };
    } catch (error) {
      return this.dbFallback("comments", { items: [], total: 0 }, error);
    }
  }

  async addComment(
    postId: string,
    user: string,
    handle: string,
    text: string,
    media?: string | null,
  ): Promise<{
    id: string;
    user: string;
    handle: string;
    text: string;
    media: string | null;
    ts: number;
  }> {
    await this.ensureUser(user);
    const row = await this.prisma.comment.create({
      data: { postId, userId: user, handle, text, media: media ?? null },
    });
    await this.bumpPostCounter(postId, "replies", 1);
    this.publishSocial({ op: "comment.created", postId });
    return {
      id: row.id,
      user: row.userId ?? user,
      handle: row.handle,
      text: row.text,
      media: row.media,
      ts: row.createdAt.getTime(),
    };
  }

  /** A user-authored post (ai=false) â€” text + optional uploaded media[]. */
  async createUserPost(input: {
    userId: string;
    handleId: string;
    handle: string;
    name: string;
    category: string;
    marketId: string;
    summary: string;
    body: string[];
    media?: { kind: "image" | "video"; src: string }[];
  }): Promise<PostEvent> {
    const ts = new Date();
    const id = `user:${input.userId}:${ts.getTime()}`;
    await this.ensureUser(input.userId);
    const post = await this.prisma.post.create({
      data: {
        id,
        authorId: input.userId,
        handleId: input.handleId,
        handle: input.handle,
        name: input.name,
        category: input.category,
        kind: "new",
        marketId: input.marketId,
        summary: input.summary,
        body: input.body,
        replies: 0,
        reposts: 0,
        likes: 0,
        views: 0,
        sources: [],
        media: input.media ?? [],
        ai: false,
        ts,
      },
    });
    this.publishSocial({ op: "post.created", postId: post.id, handleId: input.handleId });
    return this.toPost(post);
  }

  // --- views -----------------------------------------------------------------

  /** Record one post view (public â€” deduped client-side per session). Returns
   *  the new count, or null when the post is missing / Postgres is down. */
  async incrementViews(id: string): Promise<number | null> {
    try {
      const row = await this.prisma.post.update({
        where: { id },
        data: { views: { increment: 1 } },
      });
      return row.views;
    } catch (error) {
      return this.dbFallback("incrementViews", null, error);
    }
  }

  // --- deletion --------------------------------------------------------------

  /** Delete one's own post (author-only). The DB cascades Comment/Repost/
   *  Bookmark rows (onDelete: Cascade); polymorphic Like rows share no FK with
   *  Post (window/handle ids live in the same column), so feed-likes on the
   *  post are cleared here. Returns false when the post is missing, not the
   *  caller's, or an AI aggregate. */
  async deletePost(userId: string, postId: string): Promise<boolean> {
    try {
      const post = await this.prisma.post.findUnique({ where: { id: postId } });
      if (!post || post.ai || post.authorId?.toLowerCase() !== userId.toLowerCase()) {
        return false;
      }
      await this.prisma.post.delete({ where: { id: postId } });
      try {
        await this.prisma.like.deleteMany({
          where: { targetId: postId, targetType: "feed" },
        });
      } catch {
        /* best-effort â€” the FK cascade already removed comments/reposts/bookmarks */
      }
      this.publishSocial({ op: "post.deleted", postId, handleId: post.handleId });
      return true;
    } catch {
      return false;
    }
  }

  /** Delete one's own comment (author-only) and push the post's fresh reply
   *  count. Nothing hangs off a Comment row (comment likes are unwired), so
   *  the FK cascade to Post is the only relation involved. */
  async deleteComment(userId: string, commentId: string): Promise<boolean> {
    try {
      const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
      if (!comment?.userId || comment.userId.toLowerCase() !== userId.toLowerCase()) {
        return false;
      }
      await this.prisma.comment.delete({ where: { id: commentId } });
      this.publishSocial({ op: "comment.deleted", postId: comment.postId });
      await this.bumpPostCounter(comment.postId, "replies", -1);
      return true;
    } catch {
      return false;
    }
  }

  // --- status helpers ---------------------------------------------------------

  async isLiked(
    userId: string,
    targetId: string,
    targetType: LikeTargetType,
  ): Promise<boolean> {
    try {
      return (
        (await this.prisma.like.count({
          where: { userId, targetId, targetType },
        })) > 0
      );
    } catch (error) {
      return this.dbFallback("isLiked", this.localLikes.has(likeKey(userId, targetId, targetType)), error);
    }
  }

  async isReposted(userId: string, eventId: string): Promise<boolean> {
    try {
      return (
        (await this.prisma.repost.count({ where: { userId, eventId } })) > 0
      );
    } catch (error) {
      return this.dbFallback("isReposted", this.localReposts.has(repostKey(userId, eventId)), error);
    }
  }

  /** Users who liked a target. */
  async likers(targetId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.like.findMany({ where: { targetId } });
      return rows.map((r) => r.userId);
    } catch {
      return [...this.localLikes]
        .filter((k) => k.includes(`\u0000${targetId}\u0000`))
        .map((k) => k.split("\u0000")[0]!);
    }
  }

  /** Users who reposted an event. */
  async repostedBy(eventId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.repost.findMany({ where: { eventId } });
      return rows.map((r) => r.userId);
    } catch {
      return [...this.localReposts]
        .filter((k) => k.endsWith(`\u0000${eventId}`))
        .map((k) => k.split("\u0000")[0]!);
    }
  }

  // --- follows --------------------------------------------------------------

  async follow(userId: string, handleId: string): Promise<void> {
    await this.ensureUser(userId);
    try {
      const existing = await this.prisma.follow.findUnique({
        where: { follower_following: { follower: userId, following: handleId } },
      });
      if (existing) return;
      await this.prisma.follow.create({ data: { follower: userId, following: handleId } });
      await this.notifyHandleOwner(handleId, userId);
    } catch {
      this.localFollows.add(followKey(userId, handleId));
    }
  }

  async unfollow(userId: string, handleId: string): Promise<void> {
    try {
      await this.prisma.follow.deleteMany({
        where: { follower: userId, following: handleId },
      });
    } catch {
      this.localFollows.delete(followKey(userId, handleId));
    }
  }

  async following(userId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.follow.findMany({
        where: { follower: userId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((r) => r.following);
    } catch {
      return [...this.localFollows]
        .filter((k) => k.startsWith(`${userId}\u0000`))
        .map((k) => k.split("\u0000")[1]!);
    }
  }

  async followers(handleId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.follow.findMany({
        where: { following: handleId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((r) => r.follower);
    } catch {
      return [...this.localFollows]
        .filter((k) => k.endsWith(`\u0000${handleId}`))
        .map((k) => k.split("\u0000")[0]!);
    }
  }

  // --- subscriptions (notifications) ----------------------------------------

  async subscribe(userId: string, handleId: string): Promise<void> {
    await this.ensureUser(userId);
    try {
      await this.prisma.subscription.upsert({
        where: { userId_handleId: { userId, handleId } },
        create: { userId, handleId },
        update: {},
      });
    } catch {
      this.localSubs.add(subKey(userId, handleId));
    }
  }

  async unsubscribe(userId: string, handleId: string): Promise<void> {
    try {
      await this.prisma.subscription.deleteMany({
        where: { userId, handleId },
      });
    } catch {
      this.localSubs.delete(subKey(userId, handleId));
    }
  }

  async subscriptions(userId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.subscription.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((r) => r.handleId);
    } catch {
      return [...this.localSubs]
        .filter((k) => k.startsWith(`${userId}\u0000`))
        .map((k) => k.split("\u0000")[1]!);
    }
  }

  /** Every user subscribed to a handle (for notifications). */
  async subscribersOf(handleId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.subscription.findMany({
        where: { handleId },
      });
      return rows.map((r) => r.userId);
    } catch {
      return [...this.localSubs]
        .filter((k) => k.endsWith(`\u0000${handleId}`))
        .map((k) => k.split("\u0000")[0]!);
    }
  }

  // --- likes ----------------------------------------------------------------

  async like(
    userId: string,
    targetId: string,
    targetType: LikeTargetType,
  ): Promise<void> {
    await this.ensureUser(userId);
    try {
      const existing = await this.prisma.like.findUnique({
        where: { userId_targetId_targetType: { userId, targetId, targetType } },
      });
      if (existing) return;
      await this.prisma.like.create({ data: { userId, targetId, targetType } });
      if (targetType === "feed") {
        await this.bumpPostCounter(targetId, "likes", 1);
        await this.notifyPostAuthor(targetId, userId, "like", "liked your post");
      }
    } catch {
      this.localLikes.add(likeKey(userId, targetId, targetType));
    }
  }

  async unlike(
    userId: string,
    targetId: string,
    targetType: LikeTargetType,
  ): Promise<void> {
    try {
      const res = await this.prisma.like.deleteMany({
        where: { userId, targetId, targetType },
      });
      if (res.count > 0 && targetType === "feed")
        await this.bumpPostCounter(targetId, "likes", -1);
    } catch {
      this.localLikes.delete(likeKey(userId, targetId, targetType));
    }
  }

  async likes(
    userId: string,
  ): Promise<{ targetId: string; targetType: LikeTargetType }[]> {
    try {
      const rows = await this.prisma.like.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((r) => ({
        targetId: r.targetId,
        targetType: r.targetType as LikeTargetType,
      }));
    } catch {
      return [...this.localLikes]
        .filter((k) => k.startsWith(`${userId}\u0000`))
        .map((k) => {
          const parts = k.split("\u0000");
          return {
            targetId: parts[1] ?? "",
            targetType: (parts[2] ?? "feed") as LikeTargetType,
          };
        });
    }
  }

  async likeCount(targetId: string): Promise<number> {
    try {
      return await this.prisma.like.count({ where: { targetId } });
    } catch {
      return [...this.localLikes].filter((k) =>
        k.includes(`\u0000${targetId}\u0000`),
      ).length;
    }
  }

  // --- notifications --------------------------------------------------------

  async notify(
    userId: string,
    kind: string,
    title: string,
    body: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await this.ensureUser(userId);
    const push = {
      id: `n:${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      kind,
      title,
      body,
      read: false,
      ts: Date.now(),
    };
    try {
      const row = await this.prisma.notification.create({
        data: { userId, kind, title, body, meta: meta as never },
      });
      push.id = row.id;
    } catch {
      this.logger.debug(
        `Postgres unavailable â€” notification for ${userId} held locally`,
      );
    }
    // Live push: the gateway routes `notification.pushed` to this user's
    // authenticated sockets only (see MarketGateway.broadcast). Recorded in the
    // outbox so a crash here republishes instead of dropping the ping.
    const event = {
      v: 1,
      source: "oracle",
      type: "notification.pushed",
      ts: push.ts,
      seq: 0,
      data: { userId, notification: push },
    };
    if (this.outbox) this.outbox.emit("notification.pushed", event.data);
    else this.bus?.publish(event as never);
  }

  /** Fan a notification out to every subscriber of a handle. */
  async notifySubscribers(
    handleId: string,
    kind: string,
    title: string,
    body: string,
    meta?: Record<string, unknown>,
  ): Promise<number> {
    const userIds = await this.subscribersOf(handleId);
    for (const userId of userIds)
      await this.notify(userId, kind, title, body, { ...meta, handleId });
    return userIds.length;
  }

  /** Fan a notification out to every FOLLOWER of a handle. */
  async notifyFollowersOf(
    handleId: string,
    kind: string,
    title: string,
    body: string,
    meta?: Record<string, unknown>,
  ): Promise<string[]> {
    const followerIds = await this.followers(handleId);
    for (const userId of followerIds)
      await this.notify(userId, kind, title, body, { ...meta, handleId });
    return followerIds;
  }

  /** Short display form of an address â€” notification titles never show full 0xâ€¦s. */
  private shortAddr(addr: string): string {
    return addr.length > 12 ? `${addr.slice(0, 6)}â€¦${addr.slice(-4)}` : addr;
  }

  /** Notify a post's author of a like/repost â€” best-effort; skips AI posts
   *  (authorId null), missing posts and the author acting on their own post. */
  private async notifyPostAuthor(
    postId: string,
    actorId: string,
    kind: "like" | "repost",
    verb: string,
  ): Promise<void> {
    try {
      const post = await this.prisma.post.findUnique({ where: { id: postId } });
      const author = post?.authorId;
      if (!post || !author || author === actorId) return;
      const summary = String(post.summary ?? "");
      await this.notify(
        author,
        kind,
        `${this.shortAddr(actorId)} ${verb}`,
        summary.slice(0, 140) || "Open the post to join in.",
        { postId },
      );
    } catch (error) {
      this.logger.debug(`post-author notify skipped: ${(error as Error).message}`);
    }
  }

  /** Notify a handle's owner that someone followed it â€” resolves the owner from
   *  the on-chain registry; skips unknown handles, self-follows and owner-less
   *  rows. Owner is lowercased to match the app's address convention. */
  private async notifyHandleOwner(handleId: string, followerId: string): Promise<void> {
    if (!this.indexer) return;
    try {
      const handles = await this.indexer.handles();
      const h = handles.find(
        (x) => x.id === handleId || x.id.toLowerCase() === handleId.toLowerCase(),
      );
      const owner = h?.owner?.toLowerCase();
      if (!h || !owner || owner === followerId.toLowerCase()) return;
      const label = `@${(h.symbol || h.name || handleId).toLowerCase()}`;
      await this.notify(
        owner,
        "follow",
        `${this.shortAddr(followerId)} followed ${label}`,
        `You have a new follower on ${label}.`,
        { handleId },
      );
    } catch (error) {
      this.logger.debug(`follow-owner notify skipped: ${(error as Error).message}`);
    }
  }

  async notifications(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{
    items: {
      id: string;
      kind: string;
      title: string;
      body: string;
      read: boolean;
      createdAt: number;
    }[];
    total: number;
  }> {
    try {
      const [rows, total] = await Promise.all([
        this.prisma.notification.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.notification.count({ where: { userId } }),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          body: r.body,
          read: r.read,
          createdAt: r.createdAt.getTime(),
          postId: (r.meta as { postId?: string } | null)?.postId ?? null,
        })),
        total,
      };
    } catch (error) {
      return this.dbFallback("notifications", { items: [], total: 0 }, error);
    }
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    try {
      await this.prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      });
    } catch {
      /* Postgres unavailable â€” nothing to mark */
    }
  }

  async markNotificationRead(userId: string, id: string): Promise<void> {
    try {
      await this.prisma.notification.updateMany({
        where: { id, userId },
        data: { read: true },
      });
    } catch {
      /* best-effort */
    }
  }

  async markNotificationUnread(userId: string, id: string): Promise<void> {
    try {
      await this.prisma.notification.updateMany({
        where: { id, userId },
        data: { read: false },
      });
    } catch {
      /* best-effort */
    }
  }

  // --- reposts --------------------------------------------------------------

  async repost(userId: string, eventId: string): Promise<void> {
    await this.ensureUser(userId);
    try {
      const existing = await this.prisma.repost.findUnique({
        where: { userId_eventId: { userId, eventId } },
      });
      if (existing) return;
      await this.prisma.repost.create({ data: { userId, eventId } });
      await this.bumpPostCounter(eventId, "reposts", 1);
      await this.notifyPostAuthor(eventId, userId, "repost", "reposted your post");
    } catch {
      this.localReposts.add(repostKey(userId, eventId));
    }
  }

  async unrepost(userId: string, eventId: string): Promise<void> {
    try {
      const res = await this.prisma.repost.deleteMany({ where: { userId, eventId } });
      if (res.count > 0) await this.bumpPostCounter(eventId, "reposts", -1);
    } catch {
      this.localReposts.delete(repostKey(userId, eventId));
    }
  }

  async reposts(userId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.repost.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((r) => r.eventId);
    } catch {
      return [...this.localReposts]
        .filter((k) => k.startsWith(`${userId}\u0000`))
        .map((k) => k.split("\u0000")[1]!);
    }
  }

  async repostCount(eventId: string): Promise<number> {
    try {
      return await this.prisma.repost.count({ where: { eventId } });
    } catch {
      return [...this.localReposts].filter((k) =>
        k.endsWith(`\u0000${eventId}`),
      ).length;
    }
  }

  // --- bookmarks --------------------------------------------------------------

  async addBookmark(userId: string, postId: string): Promise<void> {
    await this.ensureUser(userId);
    try {
      await this.prisma.bookmark.upsert({
        where: { userId_postId: { userId, postId } },
        create: { userId, postId },
        update: {},
      });
    } catch {
      this.localBookmarks.add(bookmarkKey(userId, postId));
    }
  }

  async removeBookmark(userId: string, postId: string): Promise<void> {
    try {
      await this.prisma.bookmark.deleteMany({ where: { userId, postId } });
    } catch {
      this.localBookmarks.delete(bookmarkKey(userId, postId));
    }
  }

  async isBookmarked(userId: string, postId: string): Promise<boolean> {
    try {
      return (
        (await this.prisma.bookmark.count({ where: { userId, postId } })) > 0
      );
    } catch (error) {
      return this.dbFallback("isBookmarked", this.localBookmarks.has(bookmarkKey(userId, postId)), error);
    }
  }

  /** A user's bookmarked posts (Saved), newest first, paginated â€” flags
   *  decorated since the viewer owns the list. */
  async bookmarkedPosts(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ items: PostEvent[]; total: number }> {
    try {
      const skip = Math.max(0, page - 1) * limit;
      const [rows, total] = await Promise.all([
        this.prisma.bookmark.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        this.prisma.bookmark.count({ where: { userId } }),
      ]);
      const ids = rows.map((r) => r.postId);
      if (ids.length === 0) return { items: [], total };
      const posts = await this.prisma.post.findMany({
        where: { id: { in: ids } },
      });
      const byId = new Map(posts.map((p) => [p.id, p]));
      const items = ids
        .map((id) => byId.get(id))
        .filter((p): p is NonNullable<typeof p> => p != null)
        .map((p) => this.toPost(p));
      return { items: await this.decorate(items, userId), total };
    } catch (error) {
      return this.dbFallback("bookmarkedPosts", { items: [], total: 0 }, error);
    }
  }

  /** A user's reposted posts (the Reposts tab), newest repost first,
   *  paginated â€” viewer-decorated like the bookmarks list. */
  async repostedPosts(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ items: PostEvent[]; total: number }> {
    try {
      const skip = Math.max(0, page - 1) * limit;
      const [rows, total] = await Promise.all([
        this.prisma.repost.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        this.prisma.repost.count({ where: { userId } }),
      ]);
      const ids = rows.map((r) => r.eventId);
      if (ids.length === 0) return { items: [], total };
      const posts = await this.prisma.post.findMany({
        where: { id: { in: ids } },
      });
      const byId = new Map(posts.map((p) => [p.id, p]));
      const items = ids
        .map((id) => byId.get(id))
        .filter((p): p is NonNullable<typeof p> => p != null)
        .map((p) => this.toPost(p));
      return { items: await this.decorate(items, userId), total };
    } catch (error) {
      return this.dbFallback("repostedPosts", { items: [], total: 0 }, error);
    }
  }

  // --- feed -----------------------------------------------------------------

  /** The user's following feed: full PostEvents for followed/subscribed
   *  handles plus their own reposts â€” filtered, sorted, and paginated
   *  server-side (the UI never client-side filters). */
  async followingFeed(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: PostEvent[]; total: number }> {
    try {
      const watch = [
        ...new Set([
          ...(await this.following(userId)),
          ...(await this.subscriptions(userId)),
        ]),
      ];
      const repostIds = await this.reposts(userId);
      if (watch.length === 0 && repostIds.length === 0) {
        return { items: [], total: 0 };
      }
      const where = {
        OR: [
          ...(watch.length ? [{ handleId: { in: watch } }] : []),
          ...(repostIds.length ? [{ id: { in: repostIds } }] : []),
        ],
      };
      const skip = Math.max(0, page - 1) * limit;
      const [rows, total] = await Promise.all([
        this.prisma.post.findMany({ where, orderBy: { ts: "desc" }, skip, take: limit }),
        this.prisma.post.count({ where }),
      ]);
      return {
        items: await this.decorate(
          rows.map((p) => this.toPost(p)),
          userId,
        ),
        total,
      };
    } catch {
      return { items: [], total: 0 }; /* Postgres down â€” empty feed */
    }
  }

  private readonly localFollows = new Set<string>();
  private readonly localSubs = new Set<string>();
  private readonly localLikes = new Set<string>();
  private readonly localReposts = new Set<string>();
  private readonly localBookmarks = new Set<string>();
}

function bookmarkKey(userId: string, postId: string): string {
  return `${userId}:${postId}`;
}
function followKey(userId: string, handleId: string): string {
  return `${userId}\u0000${handleId}`;
}
function subKey(userId: string, handleId: string): string {
  return `${userId}\u0000${handleId}`;
}
function likeKey(userId: string, targetId: string, targetType: string): string {
  return `${userId}\u0000${targetId}\u0000${targetType}`;
}
function repostKey(userId: string, eventId: string): string {
  return `${userId}\u0000${eventId}`;
}

