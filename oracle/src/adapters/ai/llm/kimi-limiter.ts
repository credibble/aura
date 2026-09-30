import Redis from "ioredis";

/**
 * ONE in-flight Kimi request, organisation-wide.
 *
 * Kimi answers a second concurrent request with HTTP 429 ("max organization
 * concurrency: 1"). Two independent clients talk to it — the aura model and the
 * feed's structured service — and BOTH the API and the worker container run
 * those queues, so locking inside either class (or even a single process) was
 * never enough. Everything funnels through `kimiRequest`:
 *   - ordered inside a process by `chain`;
 *   - serialised ACROSS processes by a Redis lock both containers share.
 * It is retried with backoff, since the API itself says "try again after 1
 * seconds". Without Redis the lock degrades to the in-process chain.
 */
let chain: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Cross-process single slot, keyed in the Redis both containers already use. */
const LOCK_KEY = "aura:kimi:single-slot";
/** Well above the 180s AI_FETCH timeout, so a live call is never evicted mid-flight. */
const LOCK_TTL_MS = 240_000;
/** Stop waiting on a lock that looks stuck (a crashed holder clears via the TTL). */
const LOCK_WAIT_MAX_MS = 300_000;
/** How often a waiter re-tries the lock. */
const LOCK_POLL_MS = 150;
/** Release only the lock we own, so a TTL-expired lock can't be deleted by its old owner. */
const RELEASE_LUA =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0';

let redisInit: Promise<Redis | null> | null = null;

/**
 * The shared lock connection, created once on the first AI call. Resolves null
 * when REDIS_URL is unset (unit tests) or a Redis can't be reached, in which
 * case the slot is in-process only. Waiting for `ready` once avoids running the
 * very first call unlocked while the connection is still establishing.
 */
function lockClient(): Promise<Redis | null> {
  if (redisInit) return redisInit;
  const url = process.env.REDIS_URL;
  if (!url) {
    redisInit = Promise.resolve(null);
    return redisInit;
  }
  let client: Redis;
  try {
    client = new Redis(url, {
      // Fail fast instead of queueing commands while offline and instead of
      // reconnecting forever — the lock is best-effort.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      connectTimeout: 1_000,
    });
  } catch {
    redisInit = Promise.resolve(null);
    return redisInit;
  }
  client.on("error", () => {
    /* best-effort lock — a down Redis must not take the AI path with it */
  });
  redisInit = new Promise<Redis | null>((resolve) => {
    if (client.status === "ready") return resolve(client);
    const timer = setTimeout(() => resolve(client.status === "ready" ? client : null), 2_000);
    client.once("ready", () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once("end", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
  return redisInit;
}

/** Acquire the cross-process lock, run `call`, release it. Degrades to a local run. */
async function inSingleSlot<T>(call: () => Promise<T>): Promise<T> {
  const client = await lockClient();
  if (!client) return call();

  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + LOCK_WAIT_MAX_MS;
  const acquire = async (): Promise<boolean | null> => {
    try {
      return (await client.set(LOCK_KEY, token, "PX", LOCK_TTL_MS, "NX")) === "OK";
    } catch {
      return null; // Redis unusable
    }
  };

  // Wait for the slot. A run of failures means this lock is unavailable, so
  // don't hold the job hostage — run best-effort locally.
  let failures = 0;
  for (;;) {
    const got = await acquire();
    if (got === true) break;
    if (got === null) {
      failures += 1;
      if (failures >= 3) return call();
    } else {
      failures = 0;
    }
    if (Date.now() >= deadline) return call();
    await sleep(LOCK_POLL_MS);
  }

  try {
    return await call();
  } finally {
    try {
      await client.eval(RELEASE_LUA, 1, LOCK_KEY, token);
    } catch {
      /* TTL will clear it */
    }
  }
}

/** Run `call` after every previously queued AI call has settled. */
export async function withAiSlot<T>(call: () => Promise<T>): Promise<T> {
  const result = chain.then(
    () => inSingleSlot(call),
    () => inSingleSlot(call),
  );
  // Keep the chain alive whichever way this call settles.
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * One chat-completions request, serialised behind every other AI call and
 * retried on 429/5xx (1.5s, 3s, 6s). Throws the last failure otherwise.
 *
 * The slot is taken per HTTP attempt, not across the backoff sleep: a request
 * can run to the 180s AI_FETCH timeout, and holding the Redis lock through a
 * multi-attempt retry would outlive its TTL and let a second process in.
 */
export async function kimiRequest(send: () => Promise<Response>): Promise<Response> {
  let lastError = "Kimi request failed";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await withAiSlot(() => send());
    if (res.ok) return res;
    const detail = await res.text();
    lastError = `Kimi HTTP ${res.status}: ${detail.slice(0, 200)}`;
    if (res.status !== 429 && res.status < 500) break;
    if (attempt < 3) await sleep(1500 * 2 ** attempt);
  }
  throw new Error(lastError);
}
