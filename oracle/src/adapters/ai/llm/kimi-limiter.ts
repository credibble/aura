/**
 * ONE in-flight Kimi request, organisation-wide.
 *
 * Kimi answers a second concurrent request with HTTP 429 ("max organization
 * concurrency: 1"). Two independent clients talk to it — the aura model and the
 * feed's structured service — and several queue workers drive them, so locking
 * inside either class was never enough. Everything funnels through `kimiRequest`:
 * serialised, and retried with backoff, since the API itself says "try again
 * after 1 seconds".
 */
let chain: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run `call` after every previously queued AI call has settled. */
export async function withAiSlot<T>(call: () => Promise<T>): Promise<T> {
  const result = chain.then(call, call);
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
 */
export async function kimiRequest(send: () => Promise<Response>): Promise<Response> {
  return withAiSlot(async () => {
    let lastError = "Kimi request failed";
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await send();
      if (res.ok) return res;
      const detail = await res.text();
      lastError = `Kimi HTTP ${res.status}: ${detail.slice(0, 200)}`;
      if (res.status !== 429 && res.status < 500) break;
      if (attempt < 3) await sleep(1500 * 2 ** attempt);
    }
    throw new Error(lastError);
  });
}
