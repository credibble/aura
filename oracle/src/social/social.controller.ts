import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, Req, UnauthorizedException, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import type { Request } from "express";
import { FilesInterceptor } from "@nestjs/platform-express";
import multer from "multer";
import { SocialService, type LikeTargetType, type PostEvent } from "./social.service";
import { WalletAuthGuard } from "../auth/wallet-auth.guard";
import { CloudinaryService } from "../api/cloudinary.service";
import { ok, page, paging, sliced, type ApiResponse, type Page } from "../api/api-response";

/** Structured DTOs. */
export interface CommentView {
  id: string;
  user: string;
  handle: string;
  text: string;
  ts: number;
  /** Set when `?currentUser=` is present: the caller authored this comment. */
  mine?: boolean;
}
export interface NotificationView {
  id: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
  /** Post the notification points at, when present (meta.postId). */
  postId?: string | null;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Request carrying the WalletAuthGuard-attached JWT subject. */
type AuthedRequest = Request & { user?: { userId: string } };

/** The JWT's wallet address (lowercased) — destructive actions take the actor
 *  from the token, never from a spoofable body/param. */
function actorOf(req: AuthedRequest): string {
  const userId = req.user?.userId;
  if (!userId || !ADDRESS_RE.test(userId)) throw new UnauthorizedException("Bad auth subject");
  return userId.toLowerCase();
}

/** Optional viewer from `?currentUser=0x…` — lowercased address, null when
 *  absent or malformed (reads stay public; flags simply aren't attached). */
function viewerOf(currentUser?: string): string | null {
  return currentUser && ADDRESS_RE.test(currentUser)
    ? currentUser.toLowerCase()
    : null;
}

/** Social endpoints — likes, following, subscribing, notifications, reposting,
 *  AI posts + comments (detail page). All mutations require a wallet JWT;
 *  reads are public and personalize via optional `?currentUser=0x…`. */
@Controller("v1/social")
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // --- posts + comments ------------------------------------------------------

  /** Create a user post — text + optional media (uploaded → Cloudinary). */
  @UseGuards(WalletAuthGuard)
  @Post("posts")
  @UseInterceptors(
    FilesInterceptor("files", 6, {
      storage: multer.memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async createPost(
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Body() body: { userId: string; handleId: string; handle: string; name: string; category: string; marketId: string; summary: string; bodyText: string },
  ): Promise<ApiResponse<PostEvent>> {
    const media = files?.length ? await this.cloudinary.uploadMany(files, body.summary) : [];
    const post = await this.social.createUserPost({
      userId: body.userId,
      handleId: body.handleId,
      handle: body.handle,
      name: body.name,
      category: body.category,
      marketId: body.marketId,
      summary: body.summary,
      body: [body.bodyText],
      media,
    });
    return ok(post);
  }

  /** Latest AI feed posts (optionally for one handle), paginated. `q` searches
   *  summary/handle/name; `?currentUser=` attaches the ByMe flags. */
  @Get("posts")
  async posts(
    @Query("handleId") handleId?: string,
    @Query("q") q?: string,
    @Query("currentUser") currentUser?: string,
    @Query("page") pageQ?: string,
    @Query("limit") limitQ?: string,
  ): Promise<ApiResponse<Page<PostEvent>>> {
    const { page: p, limit } = paging({ page: pageQ, limit: limitQ });
    const { items, total } = await this.social.latestPosts(
      p,
      limit,
      handleId,
      viewerOf(currentUser),
      q,
    );
    return ok(sliced(items, total, p, limit));
  }

  /** One AI post by id (detail page). */
  @Get("posts/:id")
  async post(
    @Param("id") id: string,
    @Query("currentUser") currentUser?: string,
  ): Promise<ApiResponse<PostEvent>> {
    const post = await this.social.post(id, viewerOf(currentUser));
    if (!post) throw new NotFoundException(`No post ${id}`);
    return ok(post);
  }

  /** Comments on a post, paginated. */
  @Get("posts/:id/comments")
  async comments(
    @Param("id") id: string,
    @Query("currentUser") currentUser?: string,
    @Query("page") pageQ?: string,
    @Query("limit") limitQ?: string,
  ): Promise<ApiResponse<Page<CommentView>>> {
    const { page: p, limit } = paging({ page: pageQ, limit: limitQ });
    const { items, total } = await this.social.comments(
      id,
      p,
      limit,
      viewerOf(currentUser),
    );
    return ok(sliced(items, total, p, limit));
  }

  /** Add a comment to a post. `media` is an attached reaction GIF (a /gifs
   *  path or https URL); text may be empty when a GIF is sent. */
  @UseGuards(WalletAuthGuard)
  @Post("posts/:id/comments")
  async addComment(
    @Param("id") id: string,
    @Body() body: { user: string; handle: string; text?: string; media?: string },
  ): Promise<ApiResponse<CommentView>> {
    const text = String(body.text ?? "").trim();
    const media = body.media ? String(body.media) : null;
    if (!text && !media) throw new BadRequestException("comment needs text or a GIF");
    if (media && !/^(\/gifs\/[a-z0-9_.-]+|https:\/\/)/i.test(media))
      throw new BadRequestException("media must be a /gifs path or an https URL");
    return ok(await this.social.addComment(id, body.user, body.handle, text, media));
  }

  /** Who liked a post + the count. */
  @Get("posts/:id/likes")
  async postLikes(
    @Param("id") id: string,
    @Query("currentUser") currentUser?: string,
  ): Promise<ApiResponse<{ count: number; users: string[]; likedByMe?: boolean }>> {
    const viewer = viewerOf(currentUser);
    const [count, users] = await Promise.all([
      this.social.likeCount(id),
      this.social.likers(id),
    ]);
    return ok({
      count,
      users,
      ...(viewer ? { likedByMe: await this.social.isLiked(viewer, id, "feed") } : {}),
    });
  }

  /** Who reposted a post + the count. */
  @Get("posts/:id/reposts")
  async postReposts(
    @Param("id") id: string,
    @Query("currentUser") currentUser?: string,
  ): Promise<ApiResponse<{ count: number; users: string[]; repostedByMe?: boolean }>> {
    const viewer = viewerOf(currentUser);
    const [count, users] = await Promise.all([
      this.social.repostCount(id),
      this.social.repostedBy(id),
    ]);
    return ok({
      count,
      users,
      ...(viewer ? { repostedByMe: await this.social.isReposted(viewer, id) } : {}),
    });
  }

  /** Record a post view — public, no auth (deduped client-side per session). */
  @Post("posts/:id/view")
  async view(@Param("id") id: string): Promise<ApiResponse<{ views: number | null }>> {
    return ok({ views: await this.social.incrementViews(id) });
  }

  /** Delete one's own post (actor from the JWT) — DB cascades its
   *  comments/reposts/bookmarks; feed-likes are cleared alongside. */
  @UseGuards(WalletAuthGuard)
  @Delete("posts/:id")
  async deletePost(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<{ ok: boolean }>> {
    if (!(await this.social.deletePost(actorOf(req), id))) {
      throw new NotFoundException(`No post ${id} (or not yours)`);
    }
    return ok({ ok: true });
  }

  /** Delete one's own comment (actor from the JWT). */
  @UseGuards(WalletAuthGuard)
  @Delete("comments/:commentId")
  async deleteComment(
    @Param("commentId") commentId: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<{ ok: boolean }>> {
    if (!(await this.social.deleteComment(actorOf(req), commentId))) {
      throw new NotFoundException(`No comment ${commentId} (or not yours)`);
    }
    return ok({ ok: true });
  }

  // --- bookmarks --------------------------------------------------------------

  /** Bookmark (save) a post for the user. */
  @UseGuards(WalletAuthGuard)
  @Post(":userId/bookmarks")
  async addBookmark(@Param("userId") userId: string, @Body() body: { postId: string }): Promise<ApiResponse<{ ok: boolean }>> {
    await this.social.addBookmark(userId, body.postId);
    return ok({ ok: true });
  }

  /** Remove a bookmark. */
  @UseGuards(WalletAuthGuard)
  @Delete(":userId/bookmarks")
  async removeBookmark(@Param("userId") userId: string, @Body() body: { postId: string }): Promise<ApiResponse<{ ok: boolean }>> {
    await this.social.removeBookmark(userId, body.postId);
    return ok({ ok: true });
  }

  /** The user's bookmarked posts (Saved) — viewer via `?currentUser=`. */
  @Get("bookmarks")
  async bookmarks(
    @Query("currentUser") currentUser?: string,
    @Query("page") pageQ?: string,
    @Query("limit") limitQ?: string,
  ): Promise<ApiResponse<Page<PostEvent>>> {
    const viewer = viewerOf(currentUser);
    if (!viewer) throw new BadRequestException("bookmarks require ?currentUser=0x…");
    const { page: p, limit } = paging({ page: pageQ, limit: limitQ });
    const { items, total } = await this.social.bookmarkedPosts(viewer, p, limit);
    return ok(sliced(items, total, p, limit));
  }

  /** The user's reposted posts (the /saved Reposts tab) — viewer via `?currentUser=`. */
  @Get("reposted")
  async reposted(
    @Query("currentUser") currentUser?: string,
    @Query("page") pageQ?: string,
    @Query("limit") limitQ?: string,
  ): Promise<ApiResponse<Page<PostEvent>>> {
    const viewer = viewerOf(currentUser);
    if (!viewer) throw new BadRequestException("reposted require ?currentUser=0x…");
    const { page: p, limit } = paging({ page: pageQ, limit: limitQ });
    const { items, total } = await this.social.repostedPosts(viewer, p, limit);
    return ok(sliced(items, total, p, limit));
  }

  // --- follows --------------------------------------------------------------

  @UseGuards(WalletAuthGuard)
  @Post("follow")
  async follow(@Body() body: { userId: string; handleId: string }): Promise<ApiResponse<{ ok: boolean }>> {
    await this.social.follow(body.userId, body.handleId);
    return ok({ ok: true });
  }

  @UseGuards(WalletAuthGuard)
  @Delete("follow")
  async unfollow(@Body() body: { userId: string; handleId: string }): Promise<ApiResponse<{ ok: boolean }>> {
    await this.social.unfollow(body.userId, body.handleId);
    return ok({ ok: true });
  }

  @Get(":userId/following")
  async following(@Param("userId") userId: string, @Query("page") pageQ?: string, @Query("limit") limitQ?: string): Promise<ApiResponse<Page<string>>> {
    const { page: p, limit } = paging({ page: pageQ, limit: limitQ });
    const items = await this.social.following(userId);
    return ok(page(items, items.length, p, limit));
  }

  @Get(":handleId/followers")
  async followers(@Param("handleId") handleId: string, @Query("page") pageQ?: string, @Query("limit") limitQ?: string): Promise<ApiResponse<Page<string>>> {
    const { page: p, limit } = paging({ page: pageQ, limit: limitQ });
    const items = await this.social.followers(handleId);
    return ok(page(items, items.length, p, limit));
  }

  // --- subscriptions --------------------------------------------------------

  @UseGuards(WalletAuthGuard)
  @Post("subscribe")
  async subscribe(@Body() body: { userId: string; handleId: string }): Promise<ApiResponse<{ ok: boolean }>> {
    await this.social.subscribe(body.userId, body.handleId);
    return ok({ ok: true });
  }

  @UseGuards(WalletAuthGuard)
  @Delete("subscribe")
  async unsubscribe(@Body() body: { userId: string; handleId: string }): Promise<ApiResponse<{ ok: boolean }>> {
    await this.social.unsubscribe(body.userId, body.handleId);
    return ok({ ok: true });
  }

  @Get(":userId/subscriptions")
  async subscriptions(@Param("userId") userId: string, @Query("page") pageQ?: string, @Query("limit") limitQ?: string): Promise<ApiResponse<Page<string>>> {
    const { page: p, limit } = paging({ page: pageQ, limit: limitQ });
    const items = await this.social.subscriptions(userId);
    return ok(page(items, items.length, p, limit));
  }

  // --- likes ----------------------------------------------------------------

  @UseGuards(WalletAuthGuard)
  @Post("like")
  async like(@Body() body: { userId: string; targetId: string; targetType: LikeTargetType }): Promise<ApiResponse<{ ok: boolean }>> {
    await this.social.like(body.userId, body.targetId, body.targetType);
    return ok({ ok: true });
  }

  @UseGuards(WalletAuthGuard)
  @Delete("like")
  async unlike(@Body() body: { userId: string; targetId: string; targetType: LikeTargetType }): Promise<ApiResponse<{ ok: boolean }>> {
    await this.social.unlike(body.userId, body.targetId, body.targetType);
    return ok({ ok: true });
  }

  @Get(":userId/likes")
  async likes(@Param("userId") userId: string, @Query("page") pageQ?: string, @Query("limit") limitQ?: string): Promise<ApiResponse<Page<{ targetId: string; targetType: LikeTargetType }>>> {
    const { page: p, limit } = paging({ page: pageQ, limit: limitQ });
    const items = await this.social.likes(userId);
    return ok(page(items, items.length, p, limit));
  }

  // --- reposts ---------------------------------------------------------------

  /** The user's reposted post ids (hydrates the feed's repost state). */
  @Get(":userId/reposts")
  async reposts(@Param("userId") userId: string, @Query("page") pageQ?: string, @Query("limit") limitQ?: string): Promise<ApiResponse<Page<string>>> {
    const { page: p, limit } = paging({ page: pageQ, limit: limitQ });
    const items = await this.social.reposts(userId);
    return ok(page(items, items.length, p, limit));
  }

  // --- notifications --------------------------------------------------------

  @Get(":userId/notifications")
  async notifications(@Param("userId") userId: string, @Query("page") pageQ?: string, @Query("limit") limitQ?: string): Promise<ApiResponse<Page<NotificationView>>> {
    const { page: p, limit } = paging({ page: pageQ, limit: limitQ });
    const { items, total } = await this.social.notifications(userId, p, limit);
    return ok(sliced(items, total, p, limit));
  }

  @UseGuards(WalletAuthGuard)
  @Post(":userId/notifications/:id/read")
  async markRead(@Param("userId") userId: string, @Param("id") id: string): Promise<ApiResponse<{ ok: boolean }>> {
    await this.social.markNotificationRead(userId, id);
    return ok({ ok: true });
  }

  @UseGuards(WalletAuthGuard)
  @Post(":userId/notifications/:id/unread")
  async markUnread(@Param("userId") userId: string, @Param("id") id: string): Promise<ApiResponse<{ ok: boolean }>> {
    await this.social.markNotificationUnread(userId, id);
    return ok({ ok: true });
  }

  @UseGuards(WalletAuthGuard)
  @Post(":userId/notifications/read-all")
  async markAllRead(@Param("userId") userId: string): Promise<ApiResponse<{ ok: boolean }>> {
    await this.social.markAllNotificationsRead(userId);
    return ok({ ok: true });
  }

  // --- reposts + feed -------------------------------------------------------

  @UseGuards(WalletAuthGuard)
  @Post("repost")
  async repost(@Body() body: { userId: string; eventId: string }): Promise<ApiResponse<{ ok: boolean }>> {
    await this.social.repost(body.userId, body.eventId);
    return ok({ ok: true });
  }

  @UseGuards(WalletAuthGuard)
  @Delete("repost")
  async unrepost(@Body() body: { userId: string; eventId: string }): Promise<ApiResponse<{ ok: boolean }>> {
    await this.social.unrepost(body.userId, body.eventId);
    return ok({ ok: true });
  }

  /** The user's following feed — filtered server-side (followed/subscribed
   *  handles + own reposts), newest first, paginated. */
  @Get(":userId/feed")
  async feed(@Param("userId") userId: string, @Query("page") pageQ?: string, @Query("limit") limitQ?: string): Promise<ApiResponse<Page<PostEvent>>> {
    const { page: p, limit } = paging({ page: pageQ, limit: limitQ });
    const { items, total } = await this.social.followingFeed(userId, p, limit);
    return ok(sliced(items, total, p, limit));
  }
}