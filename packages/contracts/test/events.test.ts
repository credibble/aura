import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  EVENT_VERSION,
  isAuraEvent,
  type AuraEventUnion,
} from "../src/events";
import { isWsClientMessage, type WsClientMessage } from "../src/protocol";

describe("event envelope", () => {
  it("recognizes a well-formed event", () => {
    const event: AuraEventUnion = {
      v: 1,
      source: "oracle",
      type: "window.resolved",
      ts: Date.now(),
      seq: 42,
      data: { handleId: "btc", windowStart: 1 } as unknown as AuraEventUnion["data"],
    };
    expect(event.v).toBe(EVENT_VERSION);
    expect(isAuraEvent(event)).toBe(true);
  });

  it("rejects malformed events", () => {
    expect(isAuraEvent(null)).toBe(false);
    expect(isAuraEvent("nope")).toBe(false);
    expect(isAuraEvent({ v: 2, source: "oracle" })).toBe(false);
  });
});

describe("channels", () => {
  it("derives stable stats keys", () => {
    expect(CHANNELS.statsKey("btc")).toBe("stats:btc");
  });
});

describe("ws protocol", () => {
  it("validates client messages", () => {
    const hello: WsClientMessage = { v: 1, type: "hello", data: { since: 123 } };
    const subscribe: WsClientMessage = { v: 1, type: "subscribe", data: ["@btc"] };
    const ping: WsClientMessage = { v: 1, type: "ping" };
    expect(isWsClientMessage(hello)).toBe(true);
    expect(isWsClientMessage(subscribe)).toBe(true);
    expect(isWsClientMessage(ping)).toBe(true);
    expect(isWsClientMessage({ v: 1, type: "pong" })).toBe(false);
  });
});