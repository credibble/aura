import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { REDIS } from "../../queue/queue.constants";
import { AdapterRegistry } from "../../adapters/adapter-registry.service";
import { SourceFetcher } from "../../ingestion/source-fetcher.service";
import { SourceCacheService } from "../source-cache/source-cache.service";
import { WsBroadcastService } from "../ws/ws-broadcast.service";
import { FeedAiService, type FeedInput } from "./feed-ai.service";
import { PrismaService } from "../../persistence/prisma.service";
import type { AuraHandle } from "../jobs.types";
import type { FeedEvent } from "@aura/contracts";

const HORIZON_MS = 6 * 60 * 60 * 1000;
const MAX_POSTED = 20;
const MAX_MEDIA = 4;

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
    const sources = this.adapters.buildFromJsonStrings(handle.sources);

    let newItemCount = 0;
    let newestTs = lastPosted ?? 0;
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
      newItemCount += fresh.length;
      for (const item of fresh) newestTs = Math.max(newestTs, item.publishedAt);
      if (fresh.length > 0) {
        postSources.push({
          id: source.id,
          platform: feedPlatform(source.adapter?.platform),
          account: (source.adapter?.account as string | undefined) ?? source.id,
          text: fresh[0]!.text.slice(0, 280),
          ts: now,
          aura: 0,
          stats: `${fresh.length} new`,
        });
        // Pick the first fresh item's media for this post card.
        for (const item of fresh) {
          if (postMedia.length >= MAX_MEDIA) break;
          for (const media of item.media ?? []) {
            if (postMedia.length >= MAX_MEDIA) break;
            if (postMedia.some((m) => m.src === media.url)) continue;
            postMedia.push({ kind: media.kind, src: media.url, alt: media.title ?? item.text.slice(0, 80) });
          }
        }
        // A REAL signal for the AI draft — the fresh item count observed now
        // (no fabricated zero-value metrics).
        signals.push({
          sourceId: source.id,
          label: source.label,
          metrics: [{ name: "items", value: fresh.length, delta: fresh.length }],
        });
      }
    }

    if (newItemCount === 0) return null;

    const draft = await this.ai.build(
      { handleLabel: handle.label, signals, newItemCount, auraChange: 0 },
      { kind: "new", title: `@${handle.label} caught a signal`, body: `${newItemCount} new item${newItemCount === 1 ? "" : "s"} just landed on the feed.`, change: 0 },
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
          category: String(handle.category ?? 0),
          kind: draft.kind,
          marketId: handle.id,
          summary: draft.title,
          body: [draft.body],
          replies: 0,
          reposts: 0,
          likes: 0,
          views: 0,
          sources: postSources,
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