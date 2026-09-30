import { connect } from "node:net";

/**
 * Lightweight TCP reachability probe for a postgres URL. Avoids triggering the
 * Prisma engine at boot when the database is down (which can emit an unhandled
 * engine rejection). Used to gate on-init seeding.
 */
export function postgresReachable(url: string, timeoutMs = 2000): Promise<boolean> {
  return probe(url, timeoutMs);
}

/** TCP reachability probe for a redis URL — gates queue scheduling on boot. */
export function redisReachable(url: string, timeoutMs = 2000): Promise<boolean> {
  return probe(url, timeoutMs);
}

function probe(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: ReturnType<typeof connect> | null = null;
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve(ok);
    };
    try {
      const parsed = new URL(url);
      const port = Number(parsed.port || 6379);
      socket = connect({ host: parsed.hostname, port });
      socket.setTimeout(timeoutMs);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    } catch {
      resolve(false);
    }
  });
}