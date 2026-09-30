import { Injectable } from "@nestjs/common";
import { OracleEventBus } from "../../orchestration/oracle-event-bus.service";
import { emptyProof, type AuraUpdateData, type FeedEvent } from "@aura/contracts";

/**
 * WS broadcast: every job engine publishes its outcome through the in-process
 * OracleEventBus; the MarketGateway rebroadcasts those events to browsers as
 * typed socket messages (`aura`, `feed`, `window`). This keeps the WS path a
 * single fan-out with zero extra state.
 */
@Injectable()
export class WsBroadcastService {
  constructor(private readonly bus: OracleEventBus) {}

  publishAura(data: AuraUpdateData): void {
    this.bus.publish({ v: 1, source: "oracle", type: "aura.updated", ts: data.ts, seq: 0, data });
  }

  publishFeed(feed: FeedEvent): void {
    this.bus.publish({ v: 1, source: "oracle", type: "feed.event", ts: feed.ts, seq: 0, data: feed });
  }

  publishWindowOpened(
    handleId: string,
    windowStart: number,
    windowEnd: number,
    windowMinutes: number,
  ): void {
    this.bus.publish({
      v: 1,
      source: "oracle",
      type: "window.opened",
      ts: Date.now(),
      seq: 0,
      data: { handleId, windowStart, windowEnd, windowMinutes, expectation: 0, indexOpen: 0 },
    });
  }

  /** A window settled on-chain — pushes the `window` socket message. */
  publishWindowResolved(
    handleId: string,
    windowStart: number,
    windowEnd: number,
    winningOutcome: number,
  ): void {
    const now = Date.now();
    this.bus.publish({
      v: 1,
      source: "oracle",
      type: "window.resolved",
      ts: now,
      seq: 0,
      data: {
        handleId,
        windowStart,
        windowEnd,
        s: 0,
        expectation: 0,
        delta: 0,
        indexOpen: 0,
        indexClose: 0,
        direction: winningOutcome === 0 ? "up" : "down",
        itemCount: 0,
        proof: emptyProof(),
        resolvedAt: now,
      },
    });
  }

  /** User-targeted push notification — routed by the gateway to that user's sockets. */
  publishNotification(
    userId: string,
    notification: { id: string; kind: string; title: string; body: string; read: boolean; ts: number },
  ): void {
    this.bus.publish({
      v: 1,
      source: "oracle",
      type: "notification.pushed",
      ts: Date.now(),
      seq: 0,
      data: { userId, notification },
    });
  }
}