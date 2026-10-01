import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { kimiRequest } from "../src/adapters/ai/llm/kimi-limiter";

/**
 * `kimiRequest` must treat a THROWN fetch (DNS blip, connection reset, the 300s
 * timeout) as retryable, exactly like an HTTP 429/5xx. Before this it bypassed
 * the retry loop and lost the whole tick on a transient network failure.
 */

const okResponse = () =>
  ({ ok: true, status: 200, text: async () => "ok" }) as unknown as Response;

describe("kimiRequest — network retry", () => {
  beforeEach(() => {
    // No cross-process slot in tests: the local, in-process path.
    delete process.env.REDIS_URL;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("retries a thrown fetch and returns the later success", async () => {
    let calls = 0;
    const send = async () => {
      calls += 1;
      if (calls < 3) throw new Error("fetch failed");
      return okResponse();
    };
    const pending = kimiRequest(send);
    await vi.advanceTimersByTimeAsync(10_000);
    const res = await pending;
    expect(res.ok).toBe(true);
    expect(calls).toBe(3); // two network failures, then success
  });

  it("gives up after four attempts and reports the network error", async () => {
    let calls = 0;
    const send = async () => {
      calls += 1;
      throw new Error("fetch failed");
    };
    const pending = kimiRequest(send);
    const rejection = expect(pending).rejects.toThrow(/Kimi request failed: fetch failed/);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(calls).toBe(4);
  });

  it("does NOT retry a genuine 4xx client error", async () => {
    let calls = 0;
    const send = async () => {
      calls += 1;
      return { ok: false, status: 400, text: async () => "bad request" } as unknown as Response;
    };
    const pending = kimiRequest(send);
    const rejection = expect(pending).rejects.toThrow(/Kimi HTTP 400/);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(calls).toBe(1);
  });
});
