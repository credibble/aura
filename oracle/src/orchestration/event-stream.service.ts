import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

const STREAM = "events:ws";
const GROUP = "aura-ws";
/** Bounded stream: the live tail is all a browser needs; history is the subgraph. */
const MAXLEN = 10_000;

/**
 * Cross-process event fan-out over a Redis Stream.
 *
 * Why a stream and not the in-process bus: the engines run in the worker
 * process and the socket gateway runs in the API process. An `EventEmitter` only
 * fans out *within* one process, so pushes were silently lost the moment the
 * worker and the API were deployed separately. Publishing to a stream lets any
 * number of API replicas consume the same events.
 *
 * Safety properties:
 *  - a DEDICATED connection with `enableOfflineQueue: false`, so a down Redis
 *    fails fast instead of queueing (and never stalls the caller);
 *  - publishing is best-effort — the local bus still delivers in-process, so
 *    single-process development keeps working with no Redis;
 *  - consumers use a consumer group and ACK after handling, so a crashed
 *    consumer's pending entries are redelivered.
 */
@Injectable()
export class EventStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(EventStreamService.name);
  private readonly url: string;
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  private stopped = false;
  private consumerName = `api-${process.pid}`;

  constructor(config: ConfigService) {
    this.url = config.get<string>("REDIS_URL") ?? "redis://localhost:6379";
  }

  /** Best-effort publish. Resolves even when Redis is down. */
  async publish(event: unknown): Promise<void> {
    const client = this.publisher();
    if (!client) return;
    try {
      await client.xadd(STREAM, "MAXLEN", "~", String(MAXLEN), "*", "e", JSON.stringify(event));
    } catch (e) {
      this.logger.debug(`stream publish skipped: ${(e as Error).message}`);
    }
  }

  /**
   * Consume new events forever (one group, one consumer per process). `handler`
   * receives the parsed event; entries are ACKed only after it resolves.
   */
  startConsuming(handler: (event: unknown) => void | Promise<void>): void {
    const client = this.consumer();
    if (!client) return;
    void (async () => {
      await this.waitReady(client);
      await this.ensureGroup(client);
      while (!this.stopped) {
        try {
          const res = (await client.xreadgroup(
            "GROUP",
            GROUP,
            this.consumerName,
            "COUNT",
            100,
            "BLOCK",
            2000,
            "STREAMS",
            STREAM,
            ">",
          )) as [string, [string, string[]][]][] | null;
          if (!res) continue;
          for (const [, entries] of res) {
            for (const [id, fields] of entries) {
              const raw = fields[fields.indexOf("e") + 1];
              if (raw) {
                try {
                  await handler(JSON.parse(raw));
                } catch (e) {
                  this.logger.warn(`stream handler failed: ${(e as Error).message}`);
                }
              }
              await client.xack(STREAM, GROUP, id).catch(() => {});
            }
          }
        } catch (e) {
          if (this.stopped) break;
          const msg = (e as Error).message;
          // The stream is bounded (MAXLEN) and may vanish entirely, and at boot
          // the connection may not be writeable yet — either way the group has
          // to be (re)created or every read loops on NOGROUP forever.
          if (/NOGROUP|not writeable|Connection is closed|ECONNREFUSED|Stream isn't writeable/i.test(msg)) {
            await this.waitReady(client);
            await this.ensureGroup(client);
          }
          this.logger.debug(`stream read error: ${msg}`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    })();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.pub?.quit().catch(() => {});
    await this.sub?.quit().catch(() => {});
  }

  /** Waits for ioredis to be writeable (lazyConnect + no offline queue = fast fail). */
  private async waitReady(client: Redis, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (client.status !== "ready" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private async ensureGroup(client: Redis): Promise<void> {
    try {
      await client.xgroup("CREATE", STREAM, GROUP, "$", "MKSTREAM");
      this.logger.log(`Event stream ready (${STREAM} · group ${GROUP})`);
    } catch (e) {
      // BUSYGROUP = the group already exists, which is the normal case.
      if (!String((e as Error).message).includes("BUSYGROUP")) {
        this.logger.debug(`stream group: ${(e as Error).message}`);
      }
    }
  }

  private publisher(): Redis | null {
    if (!this.pub) this.pub = this.connect(`pub`);
    return this.pub;
  }

  private consumer(): Redis | null {
    if (!this.sub) this.sub = this.connect(`sub-${process.pid}`);
    return this.sub;
  }

  private connect(name: string): Redis | null {
    try {
      const client = new Redis(this.url, {
        lazyConnect: true,
        enableOfflineQueue: false, // fail fast; never queue behind a dead broker
        maxRetriesPerRequest: 2,
        retryStrategy: (times) => Math.min(times * 500, 5000),
      });
      client.on("error", (err) => this.logger.debug(`[${name}] redis: ${err.message}`));
      void client.connect().catch(() => this.logger.debug(`[${name}] redis connect failed`));
      return client;
    } catch (e) {
      this.logger.debug(`redis client unavailable: ${(e as Error).message}`);
      return null;
    }
  }
}
