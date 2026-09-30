import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Black-box API e2e — builds and SPAWNS the real server (the same entrypoint
 * production runs) and drives it over HTTP. Deliberately not in-process: booting
 * Nest inside a test worker hides native-level failures and couples the suite to
 * the runner.
 *
 *   npm run test:e2e        (builds first, then spawns `node dist/main.js`)
 *
 * No database or Redis is required: with `DB_REQUIRED=false` the app degrades
 * instead of failing, and that contract is what these assertions pin. In CI,
 * point DATABASE_URL/REDIS_URL at service containers for the full ready path.
 */
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;

let child: ChildProcess | null = null;

async function waitForUp(timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health/live`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not come up on ${BASE}`);
}

describe("oracle api (e2e)", () => {
  beforeAll(async () => {
    child = spawn(process.execPath, ["dist/main.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(PORT),
        JOBS_ENABLED: "false",
        DB_REQUIRED: "false",
        RATE_LIMIT_WRITES_PER_MIN: "5",
        NODE_ENV: "development",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[server] ${d.toString()}`));
    await waitForUp();
  }, 90_000);

  afterAll(() => {
    child?.kill();
    child = null;
  });

  it("answers liveness without touching dependencies", async () => {
    const res = await fetch(`${BASE}/health/live`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("reports readiness with a per-dependency breakdown", async () => {
    const res = await fetch(`${BASE}/health/ready`);
    expect([200, 503]).toContain(res.status);
    const body = (await res.json()) as { checks: Record<string, { ok: boolean }> };
    expect(Object.keys(body.checks).sort()).toEqual(["db", "indexer", "queues", "redis"]);
    expect(typeof body.checks.db!.ok).toBe("boolean");
  });

  it("sets hardening headers and hides the stack", async () => {
    const res = await fetch(`${BASE}/health/live`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("401s a wallet-guarded mutation without a bearer token", async () => {
    const res = await fetch(`${BASE}/v1/social/posts/some-id/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user: "0x0000000000000000000000000000000000000001",
        handle: "@x",
        text: "hi",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("404s an unknown route with a JSON body", async () => {
    const res = await fetch(`${BASE}/v1/definitely-not-a-route`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { statusCode?: number };
    expect(body.statusCode).toBe(404);
  });

  it("never 5xx's a burst of writes (limiter fails open, throttles, or 401s)", async () => {
    const calls = Array.from({ length: 12 }, (_, i) =>
      fetch(`${BASE}/v1/social/like`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "0x0000000000000000000000000000000000000001",
          targetId: `t${i}`,
        }),
      }),
    );
    const statuses = (await Promise.all(calls)).map((r) => r.status);
    expect(statuses.some((s) => s >= 500)).toBe(false);
  });
});
