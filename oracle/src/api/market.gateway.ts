import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OnGatewayConnection, WebSocketGateway } from "@nestjs/websockets";
import type { Socket } from "socket.io";
import {
  WS_VERSION,
  type HandleSnapshotDelta,
  type WsServerMessage,
} from "@aura/contracts";
import type { AuraEventUnion } from "@aura/contracts";
import { OracleEventBus } from "../orchestration/oracle-event-bus.service";
import { WalletAuthService } from "../auth/wallet-auth.service";
import { SubgraphReader } from "../jobs/subgraph/subgraph-reader.service";
import { handleSnapshot } from "../jobs/subgraph/handle-snapshot";

/**
 * Real-time push to the browser: rebroadcasts oracle events as typed
 * WebSocket messages (`hello`, `aura`, `feed`, `window`). The hello handshake
 * lists on-chain handles from the SUBGRAPH (the single source of truth).
 */
@WebSocketGateway({ cors: { origin: "*" } })
@Injectable()
export class MarketGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketGateway.name);
  private readonly server = new Map<string, Socket>();
  private readonly socketsByUser = new Map<string, Set<string>>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly bus: OracleEventBus,
    private readonly subgraph: SubgraphReader,
    private readonly auth: WalletAuthService,
    private readonly config: ConfigService,
  ) {}

  /** Only non-production accepts an unverified `userId` for convenience. */
  private get allowUnverifiedUser(): boolean {
    return this.config.get<string>("NODE_ENV") !== "production";
  }

  onModuleInit(): void {
    this.unsubscribe = this.bus.subscribe((event) => this.deliver(event, `local:${event.seq ?? 0}`));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /**
   * Fan an event out to sockets. `source` dedupes the two delivery paths
   * (in-process bus + Redis stream) so a single-process deployment never emits
   * the same event twice.
   */
  deliver(event: AuraEventUnion, source: string): void {
    if (this.seen.has(source)) return;
    this.remember(source);
    this.broadcast(event);
  }

  /** Bounded ring of recently seen sources (cheap, no unbounded growth). */
  private readonly seen = new Set<string>();
  private remember(source: string): void {
    this.seen.add(source);
    if (this.seen.size > 5_000) {
      const first = this.seen.values().next().value;
      if (first) this.seen.delete(first);
    }
  }

  handleConnection(client: Socket): void {
    this.server.set(client.id, client);
    void this.sendHello(client);
    client.on("disconnect", () => {
      this.server.delete(client.id);
      for (const [userId, sockets] of this.socketsByUser) {
        sockets.delete(client.id);
        if (sockets.size === 0) this.socketsByUser.delete(userId);
      }
    });
    // Bind the socket to an AUTHENTICATED user (wallet JWT). The client may not
    // assert its own address: an unverified `userId` would let any browser
    // subscribe to someone else's notifications.
    client.on("message", (raw: unknown) => this.handleClientMessage(client, raw));
  }

  /** Push a notification to a user's connected sockets. */
  pushNotification(
    userId: string,
    notification: { id: string; kind: string; title: string; body: string; read: boolean; ts: number },
  ): number {
    const message: WsServerMessage = {
      v: WS_VERSION,
      type: "notification",
      ts: Date.now(),
      data: notification,
    };
    let pushed = 0;
    for (const id of this.socketsByUser.get(userId) ?? []) {
      this.server.get(id)?.emit("message", message);
      pushed += 1;
    }
    return pushed;
  }

  private handleClientMessage(client: Socket, raw: unknown): void {
    if (typeof raw !== "object" || raw === null) return;
    const msg = raw as { type?: string; data?: { userId?: string; token?: string } };
    if (msg.type === "ping") {
      client.emit("message", { v: WS_VERSION, type: "pong", ts: Date.now() });
      return;
    }
    if (msg.type !== "auth") return;

    // Preferred: a wallet JWT. Verified here, so the bound user is proven.
    const token = typeof msg.data?.token === "string" ? msg.data.token : null;
    if (token) {
      try {
        const { userId } = this.auth.verify(token);
        this.bindUser(client, userId);
      } catch {
        this.logger.warn(`WS auth rejected from ${client.id}`);
        client.emit("message", { v: WS_VERSION, type: "unauthorized", ts: Date.now() });
      }
      return;
    }

    // Legacy/dev fallback: a bare address, accepted ONLY outside production so
    // local setups keep working. Production requires the token above.
    const asserted = typeof msg.data?.userId === "string" ? msg.data.userId : null;
    if (this.allowUnverifiedUser && asserted && /^0x[0-9a-f]{40}$/i.test(asserted)) {
      this.logger.debug(`WS auth: unverified user ${asserted} (non-production)`);
      this.bindUser(client, asserted.toLowerCase());
    }
  }

  /** Bind a socket to a verified user — a set for fan-out + a socket.io room. */
  private bindUser(client: Socket, userId: string): void {
    const id = userId.toLowerCase();
    const sockets = this.socketsByUser.get(id) ?? new Set<string>();
    sockets.add(client.id);
    this.socketsByUser.set(id, sockets);
    void client.join(`user:${id}`);
    this.logger.debug(`WS auth: ${id} bound to ${client.id}`);
  }

  private async sendHello(client: Socket): Promise<void> {
    const handles = await this.subgraph.handles();
    const message: WsServerMessage = {
      v: WS_VERSION,
      type: "hello",
      ts: Date.now(),
      data: { handles: handles.map((h) => handleSnapshot(h)) },
    };
    client.emit("message", message);
  }

  private broadcast(event: AuraEventUnion): void {
    // User-targeted: only that user's authenticated sockets receive it.
    if (event.type === "notification.pushed") {
      this.pushNotification(event.data.userId, event.data.notification);
      return;
    }
    const message: WsServerMessage | null = toWsMessage(event);
    if (!message) return;
    for (const client of this.server.values()) {
      client.emit("message", message);
    }
  }
}

function toWsMessage(event: AuraEventUnion): WsServerMessage | null {
  switch (event.type) {
    case "handle.snapshot": {
      const s = event.data;
      const delta: HandleSnapshotDelta = {
        handleId: s.id,
        index: s.index,
        change: s.change,
        up: s.up,
        down: s.down,
        velocity: s.velocity,
        shock: s.shock,
        dominance: s.dominance,
        proof: s.proof,
        spark: s.spark,
        ts: s.ts,
      };
      return { v: WS_VERSION, type: "snapshot", ts: event.ts, data: delta };
    }
    case "window.opened":
      return {
        v: WS_VERSION,
        type: "window.opened",
        ts: event.ts,
        data: {
          handleId: event.data.handleId,
          windowStart: event.data.windowStart,
          windowEnd: event.data.windowEnd,
          windowMinutes: event.data.windowMinutes,
        },
      };
    case "window.frozen":
      return {
        v: WS_VERSION,
        type: "window.frozen",
        ts: event.ts,
        data: {
          handleId: event.data.handleId,
          windowStart: event.data.windowStart,
          frozenAt: event.data.frozenAt,
        },
      };
    case "window.voided":
      return {
        v: WS_VERSION,
        type: "window.voided",
        ts: event.ts,
        data: {
          handleId: event.data.handleId,
          windowStart: event.data.windowStart,
          reason: event.data.reason,
          voidedAt: event.data.voidedAt,
        },
      };
    case "window.resolved":
      return { v: WS_VERSION, type: "window", ts: event.ts, data: event.data };
    case "aura.updated": {
      const a = event.data;
      return { v: WS_VERSION, type: "aura", ts: event.ts, data: { handleId: a.handleId, aura: a.aura, delta: a.delta, ts: a.ts } };
    }
    case "feed.event":
      return { v: WS_VERSION, type: "feed", ts: event.ts, data: event.data };
    case "social":
      return { v: WS_VERSION, type: "social", ts: event.ts, data: event.data };
    default:
      return null;
  }
}