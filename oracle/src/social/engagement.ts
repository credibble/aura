/**
 * The four denormalized `Post` counters the feed card renders, and how
 * "the platform reported nothing" is kept distinct from "the platform reported
 * zero" without a schema migration.
 *
 * `Post.replies/reposts/likes/views` are `Int @default(0)`, so a counter the
 * digest never reported would be stored — and then read — as a genuine-looking
 * `0`. The feed engine writes `UNREPORTED_ENGAGEMENT` for those instead, and
 * `reportedStats` drops the sentinel before the value reaches the API, where
 * the app's `hasCount` renders an absent counter as nothing and a real `0` as
 * `0`.
 */

/** The four card counters — the subset of a raw item's `stats` the app shows. */
export const POST_COUNTERS = ["replies", "reposts", "likes", "views"] as const;
export type PostCounter = (typeof POST_COUNTERS)[number];

/**
 * Stored in a `Post` counter column when the digest's platform did not report
 * that counter at all. Must stay negative: a refreshed `toPost` treats any
 * value `< 0` as unreported, which is what lets absence survive the row's
 * `@default(0)`.
 */
export const UNREPORTED_ENGAGEMENT = -1;

/** The counters the API sends: a key is present only when it was reported. */
export type PostStats = Partial<Record<PostCounter, number>>;

/** Keep only the counters the platform actually reported (sentinel dropped). */
export function reportedStats(row: Record<PostCounter, number>): PostStats {
  const out: PostStats = {};
  for (const field of POST_COUNTERS) {
    if (row[field] >= 0) out[field] = row[field];
  }
  return out;
}
