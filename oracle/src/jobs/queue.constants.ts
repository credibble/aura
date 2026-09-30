/** BullMQ queues + repeatable-job-scheduler ids for the job-oriented oracle. */

export const QUEUE_AURA = "aura";
export const QUEUE_FEED = "feed";
export const QUEUE_WINDOW = "window";
export const QUEUE_NOTIFY = "notify";
export const QUEUE_FILLS = "fills";

export const SCHEDULER_AURA = "aura-every-10s";
export const SCHEDULER_FEED = "feed-every-10m";
export const SCHEDULER_WINDOW = "window-every-5s";
export const SCHEDULER_NOTIFY = "notify-every-30s";
export const SCHEDULER_FILLS = "fills-every-10s";

/** Deterministic BullMQ jobIds — idempotent per bucket across restarts. */
export function auraJobId(handleId: string, bucketSec: number): string {
  return `aura:${handleId}:${bucketSec}`;
}

export function feedJobId(handleId: string, bucketSec: number): string {
  return `feed:${handleId}:${bucketSec}`;
}

export function windowJobId(handleId: string, startSec: number): string {
  return `window:${handleId}:${startSec}`;
}