import { describe, expect, it } from "vitest";
import {
  MIN_SLOT_MS,
  WINDOW_STATUSES,
  isTerminal,
  msLeft,
  slotBounds,
  slotLabel,
} from "../src/window";
import { windowLabel } from "../src/domain";

describe("slotBounds", () => {
  it("returns the window containing now", () => {
    const now = Date.UTC(2026, 0, 1, 12, 10, 0); // 12:10:00.000
    const { start, end } = slotBounds(now, 15);
    expect(end - start).toBe(15 * 60_000);
    expect(start).toBe(Date.UTC(2026, 0, 1, 12, 0, 0));
    expect(end).toBe(Date.UTC(2026, 0, 1, 12, 15, 0));
  });

  it("rolls to the next slot when fewer than 45s remain", () => {
    const now = Date.UTC(2026, 0, 1, 12, 14, 45); // 15s before boundary
    const { start, end } = slotBounds(now, 15);
    expect(end - start).toBe(15 * 60_000);
    expect(start).toBe(Date.UTC(2026, 0, 1, 12, 15, 0));
    expect(end).toBe(Date.UTC(2026, 0, 1, 12, 30, 0));
  });

  it("treats exactly 45s remaining as safe", () => {
    const now = Date.UTC(2026, 0, 1, 12, 14, 15);
    const { start, end } = slotBounds(now, 15);
    expect(end).toBe(Date.UTC(2026, 0, 1, 12, 15, 0));
    expect(MIN_SLOT_MS).toBe(45_000);
  });
});

describe("windowLabel", () => {
  it("formats window lengths", () => {
    expect(windowLabel(15)).toEqual({ short: "15m", long: "15-minute" });
    expect(windowLabel(60)).toEqual({ short: "1h", long: "1-hour" });
    expect(windowLabel(240)).toEqual({ short: "4h", long: "4-hour" });
    expect(windowLabel(1440)).toEqual({ short: "1d", long: "1-day" });
  });
});

describe("status helpers", () => {
  it("has exactly two terminal states", () => {
    expect(WINDOW_STATUSES).toHaveLength(4);
    expect(isTerminal("RESOLVED")).toBe(true);
    expect(isTerminal("VOIDED")).toBe(true);
    expect(isTerminal("OPEN")).toBe(false);
    expect(isTerminal("FROZEN")).toBe(false);
  });
});

describe("slot utilities", () => {
  it("computes msLeft and labels", () => {
    expect(msLeft(1000, 500)).toBe(500);
    expect(slotLabel(Date.UTC(2026, 0, 1, 12, 30, 0))).toMatch(/\d+:\d{2}/);
  });
});