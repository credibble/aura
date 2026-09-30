import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { REDIS } from "../../queue/queue.constants";
import { SOURCE_REGISTRY } from "../../core/ports/tokens";
import type { SourceRegistry } from "../../core/ports/source-registry";
import { SourceFetcher } from "../../ingestion/source-fetcher.service";
import { SourceCacheService } from "../source-cache/source-cache.service";
import { WsBroadcastService } from "../ws/ws-broadcast.service";
import { countLine } from "../aura/aura-engine.service";
import { FeedAiService, type FeedDraft, type FeedInput } from "./feed-ai.service";
import { PrismaService } from "../../persistence/prisma.service";
import type { AuraHandle } from "../jobs.types";
import type { Source } from "../../core/domain/source";
import type { RawDatum } from "../../core/domain/source-item";
import type { FeedEvent } from "@aura/contracts";

const HORIZON_MS = 6 * 60 * 60 * 1000;
const MAX_POSTED = 20;
const MAX_MEDIA = 4;

/** Words that identify a handle in prose (label + the name from its metadata). */
function handleAliases(handle: AuraHandle): string[] {
  const out = new Set<string>();
  const add = (s: string | undefined | null) => {
    const v = (s ?? "").trim().toLowerCase();
    if (v.length >= 3) out.add(v);
  };
  add(handle.label);
  try {
    const meta = JSON.parse(handle.metadata ?? "{}") as { name?: string; symbol?: string };
    add(meta.name);
    for (const word of (meta.name ?? "").split(/\s+/)) add(word);
    add(meta.symbol);
  } catch {
    /* malformed metadata — the label still works */
  }
  return [...out];
}

/**
 * Does this item actually talk about the handle?
 *
 * Without this the feed published noise: any prolific source (a GitHub release
 * feed, a general news desk) produced "@tesla caught a signal — 20 new items"
 * from items that never mention Tesla.
 */
function mentionsHandle(text: string, handle: AuraHandle): boolean {
  const hay = (text ?? "").toLowerCase();
  if (!hay) return false;
  for (const alias of handleAliases(handle)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(hay)) return true;
  }
  return false;
}

/**
 * Normalized-title key for cross-source dedupe. Rules, in order:
 *  1. collapse whitespace;
 *  2. peel a trailing outlet credit — "… - Not a Tesla App", "… | Reuters",
 *     "… — …". A tail only counts as a credit when it is short (≤ 5 words /
 *     40 chars), does not end in sentence punctuation, and starts with a
 *     capital or no letter (a lowercase clause after the dash — "… - what it
 *     means" — is part of the story, not an outlet);
 *  3. casefold;
 *  4. drop possessives ("Tesla's robotaxi" == "Tesla robotaxi");
 *  5. strip punctuation (% & quotes ellipses emoji) down to single spaces.
 * The same story carried by two feeds lands on one key; different headlines do
 * not. Returns "" when nothing readable is left — such items never merge.
 */
export function normalizeTitle(text: string): string {
  let t = (text ?? "").replace(/\s+/g, " ").trim();
  for (let pass = 0; pass < 3; pass++) {
    const m = /\s[-–—|]\s*([^-–—|]{1,40})$/u.exec(t);
    if (!m) break;
    const tail = m[1]!.trim();
    const words = tail.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 5 || /[.!?:;,]$/.test(tail)) break;
    const firstLetter = /\p{L}/u.exec(tail)?.[0];
    if (firstLetter && firstLetter !== firstLetter.toUpperCase()) break;
    t = t.slice(0, m.index).trimEnd();
  }
  return t
    .toLowerCase()
    .replace(/['’]s\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How a source is named in the fallback text and on the feed card. */
export interface StorySource {
  id: string;
  /** Human label — "Teslarati", "Google News · Tesla". */
  label: string;
  /** Feed-card account: the adapter's @handle when it has one, else the label. */
  account: string;
  /** Frontend FeedPlatform for the card ("news", "x", ...). */
  platform: string;
}

export interface StoryBatch {
  source: StorySource;
  /** Fresh, handle-relevant items this source carried. */
  items: RawDatum[];
}

export interface Story {
  /** The real item that represents the story — never a synthesized headline. */
  rep: RawDatum;
  /** The source the representative item came from. */
  repSource: StorySource;
  /** Every distinct source that carried the story, first-seen order. */
  sources: StorySource[];
  /** Every raw item that collapsed into the story, first-seen order. */
  items: RawDatum[];
}

/**
 * Collapse the same story from several feeds into ONE item: items group when
 * `normalizeTitle` agrees, the group keeps every contributing source (so the
 * card can attribute the story to all of them), and the highest-reach item
 * (engagement; ties → first seen) becomes the representative. No headline is
 * invented — the representative is always a real item.
 */
export function groupStories(batches: readonly StoryBatch[]): Story[] {
  const groups = new Map<string, Story>();
  let unkeyed = 0;
  for (const batch of batches) {
    for (const item of batch.items) {
      const key = normalizeTitle(item.text);
      const existing = key ? groups.get(key) : undefined;
      if (!existing) {
        groups.set(key || `\u0000unkeyed:${unkeyed++}`, {
          rep: item,
          repSource: batch.source,
          sources: [batch.source],
          items: [item],
        });
        continue;
      }
      existing.items.push(item);
      if (!existing.sources.some((s) => s.id === batch.source.id)) {
        existing.sources.push(batch.source);
      }
      if (reach(item) > reach(existing.rep)) {
        existing.rep = item;
        existing.repSource = batch.source;
      }
    }
  }
  return [...groups.values()];
}

function reach(item: RawDatum): number {
  return typeof item.engagement === "number" && Number.isFinite(item.engagement) ? item.engagement : 0;
}

/**
 * The fallback post, used when the AI is unavailable. It AGGREGATES instead of
 * echoing: it reports how many DISTINCT stories arrived and names the sources
 * that carried them. The old text counted raw items and then quoted the lead
 * headline verbatim — the source's own words presented as Aura's summary.
 * Deterministic (no model call), one line.
 */
export function fallbackDraft(
  label: string,
  storyCount: number,
  sourceNames: readonly string[],
): FeedDraft {
  const names = nameList(sourceNames);
  const storyWord = storyCount === 1 ? "story" : "stories";
  const sourceWord = sourceNames.length === 1 ? "source" : "sources";
  return {
    kind: "new",
    title: `@${label}: ${storyCount} new ${storyWord} from ${sourceNames.length} ${sourceWord}`.slice(0, 90),
    body: (names
      ? `${storyCount} new ${storyWord} on @${label} across ${names}.`
      : `${storyCount} new ${storyWord} on @${label}.`
    ).slice(0, 280),
    change: 0,
  };
}

/** "a, b and c" / "a, b, c, d and 2 more" — unique, deterministic, capped. */
function nameList(names: readonly string[], max = 4): string {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0]!;
  if (unique.length <= max) return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
  return `${unique.slice(0, max).join(", ")} and ${unique.length - max} more`;
}

/** Frontend FeedPlatform mapping (adapter platform → timeline platform). */
function feedPlatform(platform: string | undefined): string {
  switch (platform) {
    case "youtube":
      return "youtube";
    case "reddit":
      return "reddit";
    case "tiktok":
      return "tiktok";
    case "x":
      return "x";
    default:
      return "news";
  }
}

/** Feed-card account for a source: the adapter's @handle when it has one, else
 *  the human source label ("Teslarati") — never the raw source id. */
function sourceAccount(source: Source): string {
  const account = source.adapter?.account;
  return typeof account === "string" && account.length > 0 ? account : source.label;
}

/**
 * The feed job engine: every feed batch (10 min) it fetches each handle's
 * sources through the SHARED Redis source cache (already warm from the aura
 * job — no repeated outside API calls), checks whether anything new arrived
 * since the last post (`feed:last:<handleId>` marker), and when there is, asks
 * the AI to draft a feed post, PERSISTS it as a `Post` (frontend FeedPost
 * shape, `ai=true`) and broadcasts it over WS.
 */
@Injectable()
export class FeedEngineService {
  private readonly logger = new Logger(FeedEngineService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly fetcher: SourceFetcher,
    private readonly cache: SourceCacheService,
    private readonly ws: WsBroadcastService,
    private readonly ai: FeedAiService,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SOURCE_REGISTRY) private readonly registry: SourceRegistry,
  ) {}

  private get cacheTtlSeconds(): number {
    return this.config.get<number>("SOURCE_CACHE_TTL_SECONDS") ?? 300;
  }

  private markerKey(label: string): string {
    return `feed:last:${label}`;
  }

  /** Check for new data and (if any) draft + persist + broadcast one feed post. */
  async run(handle: AuraHandle, now: number): Promise<FeedEvent | null> {
    const lastPosted = await this.readMarker(handle.label);
    // Registry-resolved: on-chain adapter configs + the static feeds for the
    // handle's category. Reading `handle.sources` alone meant a handle without
    // platform adapters had NOTHING to read — so no feed ever got published.
    const sources = await this.registry.sourcesForHandle(handle);

    let newestTs = lastPosted ?? 0;
    /** Fresh, handle-relevant items grouped by source — deduped across sources below. */
    const batches: StoryBatch[] = [];
    // Media (images/videos) carried by the analysed source items — deduped by
    // URL and capped at MAX_MEDIA for the post card.
    const postMedia: { kind: "image" | "video"; src: string; alt: string }[] = [];

    for (const source of sources) {
      const key = {
        namespace: source.adapter?.platform ?? source.id,
        account: (source.adapter?.account as string | undefined) ?? "default",
        handle: handle.label,
      };
      const items = await this.cache.wrap(key, this.cacheTtlSeconds, () =>
        this.fetcher.fetch(source, now - HORIZON_MS, MAX_POSTED),
      );
      const fresh = lastPosted === null ? items : items.filter((i) => i.publishedAt > lastPosted);
      // RELEVANCE: a feed post has to be about the handle. Without this, a source
      // that merely publishes a lot (a GitHub release feed, a general news desk)
      // produced "@tesla caught a signal — 20 new items" from items that never
      // mention Tesla at all.
      const relevant = fresh.filter((i) => mentionsHandle(i.text, handle));
      if (relevant.length === 0) continue;
      for (const item of relevant) newestTs = Math.max(newestTs, item.publishedAt);
      // Pick fresh items' media for this post card.
      for (const item of relevant) {
        if (postMedia.length >= MAX_MEDIA) break;
        for (const media of item.media ?? []) {
          if (postMedia.length >= MAX_MEDIA) break;
          if (postMedia.some((m) => m.src === media.url)) continue;
          postMedia.push({ kind: media.kind, src: media.url, alt: media.title ?? item.text.slice(0, 80) });
        }
      }
      batches.push({
        source: {
          id: source.id,
          label: source.label,
          account: sourceAccount(source),
          platform: feedPlatform(source.adapter?.platform),
        },
        items: relevant,
      });
    }

    // ONE item per DISTINCT story: a story two feeds both carry collapses into a
    // single item that keeps every contributing source. The fallback then counts
    // stories (not raw rows), and the card attributes the story to all of them.
    const stories = groupStories(batches);

    // Nothing about this handle happened — publish nothing (an "0 new stories"
    // post is worse than an empty feed).
    if (stories.length === 0) return null;

    // Every source that carried any story, first-seen order — each story entry
    // below names the sources it came from, and the fallback names them all.
    const storySources = [
      ...new Map(stories.flatMap((s) => s.sources).map((s): [string, StorySource] => [s.id, s])).values(),
    ];
    const postSources = stories.map((story) => ({
      id: story.sources.map((s) => s.id).join("+"),
      // The card line shows the representative item's platform; the account
      // string attributes the story to every source that carried it.
      platform: story.repSource.platform,
      account: story.sources.map((s) => s.account).join(" · "),
      text: story.rep.text.slice(0, 280),
      ts: now,
      aura: 0,
      // The endpoint's own engagement when it has any (X likes/views, Reddit
      // score/comments), else how many items backed the story.
      stats: countLine(story.rep.stats) || `${story.items.length} new`,
    }));

    // A REAL signal for the AI draft — each distinct story's verbatim headlines,
    // labelled with every source that carried it. Distinct stories, not raw
    // items, so the model does not see the same piece twice.
    const signals: FeedInput["signals"] = stories.map((story) => ({
      sourceId: story.sources.map((s) => s.id).join("+"),
      label: story.sources.map((s) => s.label).join(" + "),
      metrics: [{ name: "items", value: story.items.length, delta: story.items.length }],
      items: story.items.slice(0, 3).map((i) => i.text.slice(0, 200)),
    }));

    const draft = await this.ai.build(
      {
        handleLabel: handle.label,
        signals,
        // Distinct stories, not raw items — the same number the fallback reports.
        newItemCount: stories.length,
        auraChange: 0,
      },
      fallbackDraft(handle.label, stories.length, storySources.map((s) => s.label)),
    );

    const feed: FeedEvent = {
      id: `feed:${handle.label}:${now}`,
      assetId: handle.id,
      kind: draft.kind,
      title: draft.title,
      body: draft.body,
      ts: now,
      change: draft.change,
    };

    await this.writeMarker(handle.label, newestTs || now);

    // Persist the AI feed post for the frontend timeline/detail pages.
    try {
      await this.prisma.post.create({
        data: {
          id: feed.id,
          handleId: handle.id,
          handle: `@${handle.label}`,
          name: handle.label,
          category: String(handle.categories[0] ?? 0),
          kind: draft.kind,
          marketId: handle.id,
          summary: draft.title,
          body: [draft.body],
          replies: 0,
          reposts: 0,
          likes: 0,
          views: 0,
          sources: postSources,
          // Media extracted from the source items (RSS enclosures / media:content
          // / inline <img>). It was collected and then dropped here, so every
          // feed card was text-only even when the story had artwork.
          ...(postMedia.length ? { media: postMedia } : {}),
          ai: true,
          ts: new Date(now),
        },
      });
    } catch (error) {
      this.logger.warn(`@${handle.label}: post persist failed: ${(error as Error).message}`);
    }

    this.ws.publishFeed(feed);
    this.logger.debug(`@${handle.label}: posted feed (${stories.length} stories)`);
    return feed;
  }

  private async readMarker(label: string): Promise<number | null> {
    try {
      const raw = await this.redis.get(this.markerKey(label));
      return raw ? Number(raw) : null;
    } catch {
      return null;
    }
  }

  private async writeMarker(label: string, ts: number): Promise<void> {
    try {
      await this.redis.set(this.markerKey(label), String(ts));
    } catch {
      /* redis down — next batch re-posts */
    }
  }
}