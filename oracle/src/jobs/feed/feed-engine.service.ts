import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { REDIS } from "../../queue/queue.constants";
import { SOURCE_REGISTRY } from "../../core/ports/tokens";
import type { SourceRegistry } from "../../core/ports/source-registry";
import { AdapterRegistry } from "../../adapters/adapter-registry.service";
import { SourceFetcher } from "../../ingestion/source-fetcher.service";
import { SourceCacheService } from "../source-cache/source-cache.service";
import { WsBroadcastService } from "../ws/ws-broadcast.service";
import { countLine } from "../aura/aura-engine.service";
import { FeedAiService, type FeedDraft, type FeedInput } from "./feed-ai.service";
import { PrismaService } from "../../persistence/prisma.service";
import type { AuraHandle } from "../jobs.types";
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
 * The fallback post, used when the AI is unavailable. It AGGREGATES the sources
 * that carried the story instead of echoing one headline back verbatim (what the
 * reader saw before was literally "Teslarati: Elon Musk and Trump are closer than
 * ever…" — the source's own words presented as Aura's summary).
 */
function fallbackDraft(
  label: string,
  count: number,
  lead: { source: string; text: string } | null,
  outlets: string[],
): FeedDraft {
  if (!lead) {
    return {
      kind: "new",
      title: `@${label} is in the news`,
      body: `${count} new item${count === 1 ? "" : "s"} mention @${label} across its sources.`,
      change: 0,
    };
  }
  const headline = lead.text.replace(/\s+/g, " ").trim();
  const who = outlets.length > 1 ? `${outlets.length} sources` : lead.source;
  return {
    kind: "new",
    title: `@${label}: ${headline.length > 72 ? `${headline.slice(0, 71)}…` : headline}`.slice(0, 90),
    body: `${count} new item${count === 1 ? "" : "s"} on @${label} across ${who}. Lead story: ${headline}`.slice(
      0,
      280,
    ),
    change: 0,
  };
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
    private readonly adapters: AdapterRegistry,
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

    let newItemCount = 0;
    let newestTs = lastPosted ?? 0;
    /** The freshest relevant item across all sources — the story to write about. */
    let bestLead: { ts: number; source: string; text: string } | null = null;
    const signals: FeedInput["signals"] = [];
    const postSources: { id: string; platform: string; account: string; text: string; ts: number; aura: number; stats?: string }[] = [];
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
      newItemCount += relevant.length;
      for (const item of relevant) newestTs = Math.max(newestTs, item.publishedAt);
      {
        const lead = relevant[0]!;
        if (!bestLead || lead.publishedAt > bestLead.ts) {
          bestLead = { ts: lead.publishedAt, source: source.label, text: lead.text };
        }
        postSources.push({
          id: source.id,
          platform: feedPlatform(source.adapter?.platform),
          account: (source.adapter?.account as string | undefined) ?? source.id,
          text: lead.text.slice(0, 280),
          ts: now,
          aura: 0,
          // The endpoint's own engagement when it has any (X likes/views, Reddit
          // score/comments), else the fresh-item count.
          stats: countLine(lead.stats) || `${relevant.length} new`,
        });
        // Pick the first fresh item's media for this post card.
        for (const item of relevant) {
          if (postMedia.length >= MAX_MEDIA) break;
          for (const media of item.media ?? []) {
            if (postMedia.length >= MAX_MEDIA) break;
            if (postMedia.some((m) => m.src === media.url)) continue;
            postMedia.push({ kind: media.kind, src: media.url, alt: media.title ?? item.text.slice(0, 80) });
          }
        }
        // A REAL signal for the AI draft — the verbatim headlines so the post can
        // be about the actual story, not "N items arrived".
        signals.push({
          sourceId: source.id,
          label: source.label,
          metrics: [{ name: "items", value: relevant.length, delta: relevant.length }],
          items: relevant.slice(0, 3).map((i) => i.text.slice(0, 200)),
        });
      }
    }

    // Nothing about this handle happened — publish nothing (an "0 new items"
    // post is worse than an empty feed).
    if (newItemCount === 0) return null;

    const draft = await this.ai.build(
      { handleLabel: handle.label, signals, newItemCount, auraChange: 0 },
      fallbackDraft(
        handle.label,
        newItemCount,
        bestLead,
        [...new Set(postSources.map((s) => s.account))],
      ),
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
    this.logger.debug(`@${handle.label}: posted feed (${newItemCount} new items)`);
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