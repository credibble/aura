/** Shared ioredis client token (dedup, source cache, job flags, pub/sub). */
export const REDIS = Symbol("REDIS");