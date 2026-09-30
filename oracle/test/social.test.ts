import { describe, expect, it } from "vitest";
import { SocialService } from "../src/social/social.service";

/** Fake Prisma social delegates (follows/likes/subscriptions/notifications/reposts/bookmarks). */
class FakeSocial {
  follows: { follower: string; following: string; createdAt: Date }[] = [];
  likes: { userId: string; targetId: string; targetType: string; createdAt: Date }[] = [];
  subs: { userId: string; handleId: string; createdAt: Date }[] = [];
  notifications: { id: string; userId: string; kind: string; title: string; body: string; read: boolean; createdAt: Date }[] = [];
  reposts: { userId: string; eventId: string; createdAt: Date }[] = [];
  bookmarkRows: { userId: string; postId: string; createdAt: Date }[] = [];
  commentRows: { id: string; postId: string; userId: string | null; handle: string; text: string; likes: number; createdAt: Date }[] = [];
  n = 0;
  nc = 0;

  user = { upsert: async () => ({}) };

  follow = {
    findUnique: async (a: { where: { follower_following: { follower: string; following: string } } }) => {
      const k = a.where.follower_following;
      return this.follows.find((r) => r.follower === k.follower && r.following === k.following) ?? null;
    },
    create: async (a: { data: { follower: string; following: string } }) => {
      const row = { ...a.data, createdAt: new Date() };
      this.follows.push(row);
      return row;
    },
    upsert: async (a: { create: { follower: string; following: string } }) => {
      if (!this.follows.some((r) => r.follower === a.create.follower && r.following === a.create.following)) this.follows.push({ ...a.create, createdAt: new Date() });
    },
    deleteMany: async (a: { where: { follower: string; following: string } }) => {
      this.follows = this.follows.filter((r) => !(r.follower === a.where.follower && r.following === a.where.following));
      return { count: 0 };
    },
    findMany: async (a: { where: { follower?: string; following?: string } }) =>
      this.follows.filter((r) => (a.where.follower ? r.follower === a.where.follower : true) && (a.where.following ? r.following === a.where.following : true)),
  };
  like = {
    findUnique: async (a: { where: { userId_targetId_targetType: { userId: string; targetId: string; targetType: string } } }) => {
      const k = a.where.userId_targetId_targetType;
      return this.likes.find((r) => r.userId === k.userId && r.targetId === k.targetId && r.targetType === k.targetType) ?? null;
    },
    create: async (a: { data: { userId: string; targetId: string; targetType: string } }) => {
      const row = { ...a.data, createdAt: new Date() };
      this.likes.push(row);
      return row;
    },
    upsert: async (a: { create: { userId: string; targetId: string; targetType: string } }) => {
      if (!this.likes.some((r) => r.userId === a.create.userId && r.targetId === a.create.targetId && r.targetType === a.create.targetType)) this.likes.push({ ...a.create, createdAt: new Date() });
    },
    deleteMany: async (a: { where: { userId?: string; targetId?: string; targetType?: string } }) => {
      const before = this.likes.length;
      this.likes = this.likes.filter(
        (r) =>
          !(
            (!a.where.userId || r.userId === a.where.userId) &&
            (!a.where.targetId || r.targetId === a.where.targetId) &&
            (!a.where.targetType || r.targetType === a.where.targetType)
          ),
      );
      return { count: before - this.likes.length };
    },
    findMany: async (a: { where: { userId?: string; targetId?: string | { in: string[] }; targetType?: string } }) =>
      this.likes.filter(
        (r) =>
          (!a.where.userId || r.userId === a.where.userId) &&
          matchIn(a.where.targetId, r.targetId) &&
          (!a.where.targetType || r.targetType === a.where.targetType),
      ),
    count: async (a: { where: { targetId: string } }) => this.likes.filter((r) => r.targetId === a.where.targetId).length,
  };
  subscription = {
    upsert: async (a: { create: { userId: string; handleId: string } }) => {
      if (!this.subs.some((r) => r.userId === a.create.userId && r.handleId === a.create.handleId)) this.subs.push({ ...a.create, createdAt: new Date() });
    },
    deleteMany: async () => ({ count: 0 }),
    findMany: async (a: { where: { userId?: string; handleId?: string } }) =>
      this.subs.filter((r) => (a.where.userId ? r.userId === a.where.userId : true) && (a.where.handleId ? r.handleId === a.where.handleId : true)),
  };
  notification = {
    create: async (a: { data: { userId: string; kind: string; title: string; body: string; meta?: unknown } }) => {
      this.notifications.push({ id: `n${this.n++}`, read: false, createdAt: new Date(), ...a.data });
    },
    findMany: async (a: { where: { userId?: string } }) => this.notifications.filter((r) => (a.where.userId ? r.userId === a.where.userId : true)),
    count: async (a: { where: { userId?: string } }) => this.notifications.filter((r) => (a.where.userId ? r.userId === a.where.userId : true)).length,
    updateMany: async (a: { where: { id: string; userId: string }; data: { read: boolean } }) => {
      this.notifications = this.notifications.map((n) => (n.id === a.where.id && n.userId === a.where.userId ? { ...n, read: a.data.read } : n));
      return { count: 0 };
    },
  };
  repost = {
    findUnique: async (a: { where: { userId_eventId: { userId: string; eventId: string } } }) => {
      const k = a.where.userId_eventId;
      return this.reposts.find((r) => r.userId === k.userId && r.eventId === k.eventId) ?? null;
    },
    create: async (a: { data: { userId: string; eventId: string } }) => {
      // Monotonic createdAt like bookmarks → deterministic "newest first".
      const row = { ...a.data, createdAt: new Date(1_000_000 + this.reposts.length) };
      this.reposts.push(row);
      return row;
    },
    upsert: async (a: { create: { userId: string; eventId: string } }) => {
      if (!this.reposts.some((r) => r.userId === a.create.userId && r.eventId === a.create.eventId)) this.reposts.push({ ...a.create, createdAt: new Date(1_000_000 + this.reposts.length) });
    },
    deleteMany: async (a: { where: { userId: string; eventId: string } }) => {
      const before = this.reposts.length;
      this.reposts = this.reposts.filter((r) => !(r.userId === a.where.userId && r.eventId === a.where.eventId));
      return { count: before - this.reposts.length };
    },
    findMany: async (a: { where?: { userId?: string; eventId?: string | { in: string[] } }; skip?: number; take?: number } = {}) => {
      let rows = this.reposts.filter(
        (r) =>
          (!a.where?.userId || r.userId === a.where.userId) &&
          matchIn(a.where?.eventId, r.eventId),
      );
      rows = [...rows].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
      const skip = a.skip ?? 0;
      return rows.slice(skip, skip + (a.take ?? rows.length));
    },
    count: async (a: { where: { eventId?: string; userId?: string } }) =>
      this.reposts.filter(
        (r) => (!a.where.eventId || r.eventId === a.where.eventId) && (!a.where.userId || r.userId === a.where.userId),
      ).length,
  };
  bookmark = {
    upsert: async (a: { where: { userId_postId: { userId: string; postId: string } }; create: { userId: string; postId: string } }) => {
      const { userId, postId } = a.create;
      if (!this.bookmarkRows.some((r) => r.userId === userId && r.postId === postId))
        this.bookmarkRows.push({ userId, postId, createdAt: new Date(1_000_000 + this.bookmarkRows.length) });
    },
    deleteMany: async (a: { where: { userId: string; postId: string } }) => {
      this.bookmarkRows = this.bookmarkRows.filter((r) => !(r.userId === a.where.userId && r.postId === a.where.postId));
      return { count: 0 };
    },
    count: async (a: { where: { userId: string; postId?: string } }) =>
      this.bookmarkRows.filter((r) => r.userId === a.where.userId && (!a.where.postId || r.postId === a.where.postId)).length,
    findMany: async (a: { where: { userId: string; postId?: { in: string[] } }; skip?: number; take?: number }) => {
      let rows = this.bookmarkRows.filter(
        (r) => r.userId === a.where.userId && (!a.where.postId || a.where.postId.in.includes(r.postId)),
      );
      rows = [...rows].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
      const skip = a.skip ?? 0;
      return rows.slice(skip, skip + (a.take ?? rows.length));
    },
  };
  comment = {
    create: async (a: { data: { postId: string; userId?: string | null; handle: string; text: string } }) => {
      const row = {
        id: `c${this.nc}`,
        postId: a.data.postId,
        userId: a.data.userId ?? null,
        handle: a.data.handle,
        text: a.data.text,
        likes: 0,
        createdAt: new Date(this.nc),
      };
      this.nc++;
      this.commentRows.push(row);
      return row;
    },
    findUnique: async (a: { where: { id: string } }) =>
      this.commentRows.find((r) => r.id === a.where.id) ?? null,
    delete: async (a: { where: { id: string } }) => {
      const row = this.commentRows.find((r) => r.id === a.where.id);
      if (!row) throw new Error(`missing comment ${a.where.id}`);
      this.commentRows = this.commentRows.filter((r) => r.id !== a.where.id);
      return row;
    },
    findMany: async (a: { where: { postId: string }; skip?: number; take?: number }) => {
      const rows = this.commentRows
        .filter((r) => r.postId === a.where.postId)
        .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
      const skip = a.skip ?? 0;
      return rows.slice(skip, skip + (a.take ?? rows.length));
    },
    count: async (a: { where: { postId: string } }) => this.commentRows.filter((r) => r.postId === a.where.postId).length,
  };
  posts: ReturnType<typeof postRow>[] = [];
  post = {
    findMany: async (a: {
      where?: PostWhere;
      skip?: number;
      take?: number;
    }) => {
      const rows = [...this.filterPosts(a.where)].sort((x, y) => y.ts.getTime() - x.ts.getTime());
      const skip = a.skip ?? 0;
      return rows.slice(skip, skip + (a.take ?? rows.length));
    },
    count: async (a: { where?: PostWhere }) => this.filterPosts(a.where).length,
    findUnique: async (a: { where: { id: string } }) => this.posts.find((r) => r.id === a.where.id) ?? null,
    update: async (a: { where: { id: string }; data: Record<string, { increment: number }> }) => {
      const row = this.posts.find((r) => r.id === a.where.id);
      if (!row) throw new Error(`missing post ${a.where.id}`);
      for (const [field, op] of Object.entries(a.data)) {
        const rec = row as unknown as Record<string, number>;
        rec[field] = (rec[field] ?? 0) + (op?.increment ?? 0);
      }
      return row;
    },
    /** Emulates the DB's onDelete: Cascade for Comment/Repost/Bookmark (+ the
     *  service's manual feed-like cleanup runs right after). */
    delete: async (a: { where: { id: string } }) => {
      const row = this.posts.find((r) => r.id === a.where.id);
      if (!row) throw new Error(`missing post ${a.where.id}`);
      this.posts = this.posts.filter((r) => r.id !== a.where.id);
      this.commentRows = this.commentRows.filter((r) => r.postId !== a.where.id);
      this.reposts = this.reposts.filter((r) => r.eventId !== a.where.id);
      this.bookmarkRows = this.bookmarkRows.filter((r) => r.postId !== a.where.id);
      return row;
    },
  };

  private filterPosts(where?: PostWhere) {
    let rows = this.posts;
    if (where?.handleId) rows = rows.filter((r) => r.handleId === where.handleId);
    if (where?.id?.in) rows = rows.filter((r) => where.id!.in.includes(r.id));
    if (where?.OR)
      rows = rows.filter((r) =>
        where.OR!.some((c) => {
          if (c.handleId) return c.handleId.in.includes(r.handleId);
          if (c.id) return c.id.in.includes(r.id);
          if (c.summary) return r.summary.toLowerCase().includes(c.summary.contains.toLowerCase());
          if (c.handle) return r.handle.toLowerCase().includes(c.handle.contains.toLowerCase());
          if (c.name) return r.name.toLowerCase().includes(c.name.contains.toLowerCase());
          return false;
        }),
      );
    return rows;
  }
}

/** `where: { field: "x" }` vs `{ field: { in: [...] } }` matcher. */
function matchIn(want: string | { in: string[] } | undefined, got: string): boolean {
  if (want == null) return true;
  return typeof want === "string" ? want === got : want.in.includes(got);
}

/** Post where-shapes the fake understands (equality, in-lists, contains-OR). */
type PostWhere = {
  handleId?: string;
  id?: { in: string[] };
  OR?: {
    handleId?: { in: string[] };
    id?: { in: string[] };
    summary?: { contains: string };
    handle?: { contains: string };
    name?: { contains: string };
  }[];
};

function postRow(id: string, handleId: string, ts: number, authorId: string | null = null, ai = true) {
  return {
    id,
    authorId,
    handleId,
    handle: `@${handleId}`,
    name: handleId.toUpperCase(),
    category: "ai",
    kind: "shock",
    marketId: handleId,
    summary: `${id} summary`,
    body: ["body line"],
    media: [],
    sources: [],
    replies: 0,
    reposts: 0,
    likes: 0,
    views: 0,
    ai,
    ts: new Date(ts),
    createdAt: new Date(ts),
  };
}

function make(): { social: SocialService; fake: FakeSocial } {
  const fake = new FakeSocial();
  return { social: new SocialService(fake as never), fake };
}

describe("SocialService — likes, following, subscribing, notifications, reposting", () => {
  it("follows / unfollows and lists following + followers", async () => {
    const { social } = make();
    await social.follow("u1", "btc");
    await social.follow("u1", "eth");
    await social.follow("u2", "btc");
    expect(await social.following("u1")).toEqual(["btc", "eth"]);
    expect(await social.followers("btc")).toEqual(["u1", "u2"]);
    await social.unfollow("u1", "eth");
    expect(await social.following("u1")).toEqual(["btc"]);
  });

  it("likes/unlikes with counts", async () => {
    const { social, fake } = make();
    await social.like("u1", "ev-1", "feed");
    await social.like("u2", "ev-1", "feed");
    expect(await social.likeCount("ev-1")).toBe(2);
    expect(await social.likes("u1")).toEqual([{ targetId: "ev-1", targetType: "feed" }]);
    await social.unlike("u1", "ev-1", "feed");
    expect(await social.likeCount("ev-1")).toBe(1);
  });

  it("subscribes and fans resolution notifications to subscribers", async () => {
    const { social, fake } = make();
    await social.subscribe("u1", "btc");
    await social.subscribe("u2", "btc");

    const fan = await social.notifySubscribers("btc", "resolution", "@btc settled UP", "close 68.35", { indexClose: 68.35 });
    expect(fan).toBe(2);
    const notes = await social.notifications("u1", 1, 50);
    expect(notes.total).toBe(1);
    expect(notes.items[0]!.kind).toBe("resolution");
    expect(notes.items[0]!.read).toBe(false);

    await social.markNotificationRead("u1", notes.items[0]!.id);
    expect((await social.notifications("u1", 1, 50)).items[0]!.read).toBe(true);
  });

  it("assembles the following feed server-side from followed handles + reposts", async () => {
    const { social, fake } = make();
    await social.follow("u1", "btc");
    await social.repost("u1", "ev-9");

    fake.posts = [
      postRow("ev-1", "btc", 500), // followed handle
      postRow("ev-2", "eth", 400), // not followed → excluded
      postRow("ev-9", "sol", 300), // reposted (handle not followed) → included
    ];

    const { items, total } = await social.followingFeed("u1", 1, 20);
    expect(total).toBe(2);
    // Newest first; eth excluded, the sol repost included.
    expect(items.map((p) => p.id)).toEqual(["ev-1", "ev-9"]);
    expect(items.every((p) => p.assetId !== "eth")).toBe(true);
    expect(items[0]!.name).toBe("BTC");
  });

  it("paginates the following feed", async () => {
    const { social, fake } = make();
    await social.follow("u1", "btc");
    fake.posts = [postRow("a", "btc", 300), postRow("b", "btc", 200), postRow("c", "btc", 100)];

    const page1 = await social.followingFeed("u1", 1, 2);
    expect(page1.total).toBe(3);
    expect(page1.items.map((p) => p.id)).toEqual(["a", "b"]);

    const page2 = await social.followingFeed("u1", 2, 2);
    expect(page2.items.map((p) => p.id)).toEqual(["c"]);
  });

  it("returns an empty feed when the user follows nothing", async () => {
    const { social } = make();
    expect(await social.followingFeed("u1", 1, 20)).toEqual({ items: [], total: 0 });
  });

  it("attaches viewer flags (liked/reposted/bookmarked) when currentUser is given", async () => {
    const { social, fake } = make();
    fake.posts = [postRow("ev-1", "btc", 300), postRow("ev-2", "btc", 200)];
    await social.like("u1", "ev-1", "feed");
    await social.repost("u1", "ev-1");
    await social.addBookmark("u1", "ev-1");

    const { items } = await social.latestPosts(1, 20, undefined, "u1");
    const one = items.find((p) => p.id === "ev-1")!;
    expect(one.likedByMe).toBe(true);
    expect(one.repostedByMe).toBe(true);
    expect(one.bookmarkedByMe).toBe(true);
    const two = items.find((p) => p.id === "ev-2")!;
    expect(two.likedByMe).toBe(false);
    expect(two.repostedByMe).toBe(false);
    expect(two.bookmarkedByMe).toBe(false);

    // No viewer → flags absent entirely.
    const pub = await social.latestPosts(1, 20);
    expect(pub.items[0]).not.toHaveProperty("likedByMe");
    expect(pub.items[0]).not.toHaveProperty("bookmarkedByMe");
  });

  it("decorates the following feed with the owner's flags", async () => {
    const { social, fake } = make();
    await social.follow("u1", "btc");
    await social.like("u1", "ev-1", "feed");
    fake.posts = [postRow("ev-1", "btc", 300)];

    const { items } = await social.followingFeed("u1", 1, 20);
    expect(items[0]!.likedByMe).toBe(true);
    expect(items[0]!.repostedByMe).toBe(false);
    expect(items[0]!.bookmarkedByMe).toBe(false);
  });

  it("marks the viewer's own comments as mine", async () => {
    const { social } = make();
    await social.addComment("ev-1", "u1", "@btc", "nice");
    await social.addComment("ev-1", "u2", "@eth", "meh");

    const { items } = await social.comments("ev-1", 1, 10, "u1");
    expect(items.find((c) => c.user === "u1")!.mine).toBe(true);
    expect(items.find((c) => c.user === "u2")!.mine).toBe(false);

    const anon = await social.comments("ev-1", 1, 10);
    expect(anon.items[0]).not.toHaveProperty("mine");
  });

  it("searches posts by summary/handle/name, case-insensitive, combinable with handleId", async () => {
    const { social, fake } = make();
    fake.posts = [postRow("ev-1", "btc", 300), postRow("ev-2", "eth", 200)];

    // Every summary is `${id} summary` → "SUMM" matches both.
    const hit = await social.latestPosts(1, 20, undefined, null, "SUMM");
    expect(hit.items.map((p) => p.id)).toEqual(["ev-1", "ev-2"]);

    const scoped = await social.latestPosts(1, 20, "eth", null, "ev-2");
    expect(scoped.items.map((p) => p.id)).toEqual(["ev-2"]);

    const none = await social.latestPosts(1, 20, undefined, null, "zzz");
    expect(none.total).toBe(0);
  });

  it("increments views and returns null for a missing post", async () => {
    const { social, fake } = make();
    fake.posts = [postRow("ev-1", "btc", 300)];
    expect(await social.incrementViews("ev-1")).toBe(1);
    expect(await social.incrementViews("ev-1")).toBe(2);
    expect(await social.incrementViews("nope")).toBeNull();
  });

  it("bookmarks/saves posts with flags, paging and removal", async () => {
    const { social, fake } = make();
    fake.posts = [postRow("ev-1", "btc", 300), postRow("ev-2", "eth", 200)];
    await social.addBookmark("u1", "ev-1");
    await social.addBookmark("u1", "ev-2");
    await social.addBookmark("u2", "ev-2");
    expect(await social.isBookmarked("u1", "ev-1")).toBe(true);
    expect(await social.isBookmarked("u2", "ev-1")).toBe(false);

    const saved = await social.bookmarkedPosts("u1", 1, 20);
    expect(saved.total).toBe(2);
    expect(saved.items.map((p) => p.id)).toEqual(["ev-2", "ev-1"]); // newest first
    expect(saved.items.every((p) => p.bookmarkedByMe)).toBe(true);

    const page = await social.bookmarkedPosts("u1", 1, 1);
    expect(page.items.map((p) => p.id)).toEqual(["ev-2"]);

    await social.removeBookmark("u1", "ev-1");
    expect(await social.isBookmarked("u1", "ev-1")).toBe(false);
    expect((await social.bookmarkedPosts("u1", 1, 20)).total).toBe(1);
  });

  it("lists a user's reposted posts newest-first, paginated, skipping missing posts", async () => {
    const { social, fake } = make();
    fake.posts = [postRow("ev-1", "btc", 300), postRow("ev-2", "eth", 200)];
    await social.repost("u1", "ev-1");
    await social.repost("u1", "ev-2");
    await social.repost("u2", "ev-1");

    const list = await social.repostedPosts("u1", 1, 20);
    expect(list.total).toBe(2);
    expect(list.items.map((p) => p.id)).toEqual(["ev-2", "ev-1"]); // newest first
    expect(list.items.every((p) => p.repostedByMe)).toBe(true);

    const page = await social.repostedPosts("u1", 1, 1);
    expect(page.items.map((p) => p.id)).toEqual(["ev-2"]);

    await social.unrepost("u1", "ev-1");
    expect((await social.repostedPosts("u1", 1, 20)).total).toBe(1);
    expect((await social.repostedPosts("u2", 1, 20)).total).toBe(1);

    // A row whose post no longer exists is skipped in items (defensive — in PG
    // the FK cascade removes the row with the post).
    await social.repost("u1", "ev-gone");
    const withOrphan = await social.repostedPosts("u1", 1, 20);
    expect(withOrphan.total).toBe(2);
    expect(withOrphan.items.map((p) => p.id)).toEqual(["ev-2"]);
  });

  it("notifies the post author on like/repost — skipping self, AI posts and non-feed likes", async () => {
    const { social, fake } = make();
    fake.posts = [
      postRow("ev-1", "btc", 300, "u1", false), // human post authored by u1
      postRow("feed:btc:2", "btc", 200), // AI aggregate — authorId null
    ];

    await social.like("u2", "ev-1", "feed");
    let notes = (await social.notifications("u1", 1, 10)).items;
    expect(notes).toHaveLength(1);
    expect(notes[0]!.kind).toBe("like");
    expect(notes[0]!.title).toBe("u2 liked your post");
    const likeRow = fake.notifications.find((n) => n.kind === "like");
    expect((likeRow as { meta?: { postId?: string } }).meta?.postId).toBe("ev-1");

    // Repeat like → single notification (the existing-row check returns early).
    await social.like("u2", "ev-1", "feed");
    expect((await social.notifications("u1", 1, 10)).items).toHaveLength(1);

    // Self-like → nothing new.
    await social.like("u1", "ev-1", "feed");
    expect((await social.notifications("u1", 1, 10)).items).toHaveLength(1);

    // AI post (authorId null) → nobody to notify.
    await social.like("u2", "feed:btc:2", "feed");
    expect((await social.notifications("u2", 1, 10)).items).toHaveLength(0);

    // Non-feed target → no author lookup at all.
    await social.like("u2", "ev-1", "handle");
    expect((await social.notifications("u1", 1, 10)).items).toHaveLength(1);

    // Repost fans out the same way.
    await social.repost("u2", "ev-1");
    notes = (await social.notifications("u1", 1, 10)).items;
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.kind === "repost")).toBeDefined();
    expect(notes.find((n) => n.kind === "repost")!.title).toBe("u2 reposted your post");
    const repostRow = fake.notifications.find((n) => n.kind === "repost");
    expect((repostRow as { meta?: { postId?: string } }).meta?.postId).toBe("ev-1");

    // Author reposting own post → no second repost note.
    await social.repost("u1", "ev-1");
    expect((await social.notifications("u1", 1, 10)).items).toHaveLength(2);
  });

  it("notifies the handle owner on follow — skipping self, repeats and unknown handles", async () => {
    const fake = new FakeSocial();
    const social = new SocialService(fake as never, undefined, {
      handles: async () => [
        {
          id: "0xbtc",
          owner: "0xOWNER",
          name: "Bitcoin",
          symbol: "BTC",
          contract: "0x",
          metadata: "",
          windowMinutes: 0n,
          sources: [],
          market: "",
          oracleFactory: "",
          revenue: "",
          stake: "",
          graduated: false,
          categories: [],
        },
      ],
    });

    await social.follow("u2", "0xbtc");
    const owner = (await social.notifications("0xowner", 1, 10)).items; // lowercased owner
    expect(owner).toHaveLength(1);
    expect(owner[0]!.kind).toBe("follow");
    expect(owner[0]!.title).toBe("u2 followed @btc");

    // Repeat follow → no duplicate notification.
    await social.follow("u2", "0xbtc");
    expect((await social.notifications("0xowner", 1, 10)).items).toHaveLength(1);

    // Self-follow (owner follows own handle) → nothing.
    await social.follow("0xowner", "0xbtc");
    expect((await social.notifications("0xowner", 1, 10)).items).toHaveLength(1);

    // Unknown handle → owner unresolved → no notification anywhere.
    await social.follow("u3", "0xnope");
    expect((await social.notifications("0xowner", 1, 10)).items).toHaveLength(1);
    expect((await social.notifications("u3", 1, 10)).items).toHaveLength(0);
  });

  it("marks a notification unread again", async () => {
    const { social } = make();
    await social.subscribe("u1", "btc");
    await social.notifySubscribers("btc", "resolution", "@btc settled", "close 68.35");
    const note = (await social.notifications("u1", 1, 10)).items[0]!;

    await social.markNotificationRead("u1", note.id);
    expect((await social.notifications("u1", 1, 10)).items[0]!.read).toBe(true);
    await social.markNotificationUnread("u1", note.id);
    expect((await social.notifications("u1", 1, 10)).items[0]!.read).toBe(false);
  });

  it("deletes only the author's user post and cascades its rows", async () => {
    const { social, fake } = make();
    fake.posts = [
      postRow("user:u1:1", "btc", 300, "u1", false),
      postRow("feed:btc:2", "btc", 200), // AI aggregate — never deletable
    ];
    fake.likes.push({ userId: "u2", targetId: "user:u1:1", targetType: "feed", createdAt: new Date() });
    fake.reposts.push({ userId: "u2", eventId: "user:u1:1", createdAt: new Date() });
    fake.bookmarkRows.push({ userId: "u2", postId: "user:u1:1", createdAt: new Date() });
    fake.commentRows.push({ id: "c-x", postId: "user:u1:1", userId: "u2", handle: "@btc", text: "hi", likes: 0, createdAt: new Date() });

    expect(await social.deletePost("u2", "user:u1:1")).toBe(false); // stranger
    expect(await social.deletePost("u1", "feed:btc:2")).toBe(false); // AI post
    expect(await social.deletePost("U1", "user:u1:1")).toBe(true); // owner (case-insensitive)

    expect(fake.posts.map((p) => p.id)).toEqual(["feed:btc:2"]);
    expect(fake.likes).toHaveLength(0);
    expect(fake.reposts).toHaveLength(0);
    expect(fake.bookmarkRows).toHaveLength(0);
    expect(fake.commentRows).toHaveLength(0);

    expect(await social.deletePost("u1", "user:u1:1")).toBe(false); // gone
    expect(await social.deletePost("u1", "nope")).toBe(false); // missing
  });

  it("deletes only the author's comment and keeps the reply count in step", async () => {
    const { social, fake } = make();
    fake.posts = [postRow("ev-1", "btc", 300, "u1", false)];
    const mine = await social.addComment("ev-1", "u1", "@btc", "mine");
    await social.addComment("ev-1", "u2", "@eth", "theirs");
    expect(fake.posts[0]!.replies).toBe(2);

    expect(await social.deleteComment("u2", mine.id)).toBe(false); // stranger
    expect(await social.deleteComment("u1", mine.id)).toBe(true);
    expect(fake.posts[0]!.replies).toBe(1);
    expect((await social.comments("ev-1", 1, 10)).total).toBe(1);

    expect(await social.deleteComment("u1", mine.id)).toBe(false); // gone
    expect(await social.deleteComment("u1", "nope")).toBe(false); // missing
  });
});