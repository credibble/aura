/**
 * Queue depth — the cheapest honest signal that the engine is keeping up. Read
 * through a short-lived Redis connection so /health/ready never hangs on a
 * wedged broker (the shared client queues commands while disconnected).
 */
import { Queue } from "bullmq";
import { QUEUE_AURA, QUEUE_FEED, QUEUE_WINDOW, QUEUE_NOTIFY, QUEUE_FILLS } from "./queue.constants";

const NAMES = [QUEUE_AURA, QUEUE_FEED, QUEUE_WINDOW, QUEUE_NOTIFY, QUEUE_FILLS];

export async function queueDepths(timeoutMs = 800): Promise<Record<string, number>> {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const queues = NAMES.map((name) => new Queue(name, { connection: { url, enableOfflineQueue: false } }));
  try {
    const counts = await Promise.race([
      Promise.all(queues.map((q) => q.getWaitingCount())),
      new Promise<number[]>((_, reject) =>
        setTimeout(() => reject(new Error(`queue read timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    return Object.fromEntries(NAMES.map((name, i) => [name, counts[i] ?? 0]));
  } finally {
    await Promise.all(queues.map((q) => q.close().catch(() => {})));
  }
}
