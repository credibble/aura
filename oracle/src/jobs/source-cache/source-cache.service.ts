import { Injectable, Inject } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS } from "../../queue/queue.constants";

export interface SourceCacheKey {
  /** Platform namespace, e.g. "shopify", "spotify", "github". */
  namespace: string;
  /** Account/variant within the platform, e.g. "me" or a username. */
  account: string;
  /** Handle label (no @), e.g. "devar". */
  handle: string;
}

/**
 * Redis source cache with TTL — the single fetch point for every department
 * (aura job, feed job, API) so the same external platform is never queried
 * twice within the TTL window. Keys are namespaced:
 *
 *   source:shopify:me:@devar
 *
 * `namespace` is the platform, `account` the platform-side identity and
 * `handle` the Aura handle. `wrap` runs the fetcher once, stores the JSON
 * payload and returns it for every subsequent call until the TTL expires.
 */
@Injectable()
export class SourceCacheService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Build the canonical key, e.g. `source:shopify:me:@devar`. */
  key(k: SourceCacheKey): string {
    return `source:${k.namespace}:${k.account}:@${k.handle}`;
  }

  async get<T>(k: SourceCacheKey): Promise<T | null> {
    try {
      const raw = await this.redis.get(this.key(k));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set<T>(k: SourceCacheKey, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(this.key(k), JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      /* redis down — the fetcher re-runs next time */
    }
  }

  /** Cache-around: return the cached payload or fetch + store it. */
  async wrap<T>(k: SourceCacheKey, ttlSeconds: number, fetch: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(k);
    if (cached !== null) return cached;
    const fresh = await fetch();
    await this.set(k, fresh, ttlSeconds);
    return fresh;
  }

  /** Bump a key's TTL (used to keep frequently-read handles warm). */
  async touch(k: SourceCacheKey, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.expire(this.key(k), ttlSeconds);
    } catch {
      /* noop */
    }
  }
}