import { Logger } from "@nestjs/common";
import { MIN_AURA_PERCENT, MAX_AURA_PERCENT } from "../jobs/aura/aura-band";

const logger = new Logger("DebugMode");
let warnedOnce = false;

/**
 * The single DEBUG_MODE switch every AI entry point consults.
 *
 * When on, the oracle must not touch the provider at all: no Kimi HTTP request,
 * no token usage, no organisation slot/lock. Each caller short-circuits to a
 * random/sample response instead.
 *
 * The flag is read from `process.env` rather than the DI `ConfigService` so the
 * module-level limiter (which has no container) can consult the same helper, and
 * so a test can flip it directly. `env.ts` validates `DEBUG_MODE` at boot;
 * flipping it at runtime has no effect until the oracle is rebuilt and restarted.
 */
export function isDebugMode(): boolean {
  const on = String(process.env.DEBUG_MODE ?? "").toLowerCase() === "true";
  if (on && !warnedOnce) {
    warnedOnce = true;
    logger.warn(
      "DEBUG_MODE is ON — every AI call is short-circuited and returns a random sample; no provider request will be made. Rebuild + restart the oracle to change it.",
    );
  }
  return on;
}

/**
 * A random signed aura percent inside the engine's band (e.g. `-12.4`), one
 * decimal, so a debug tick is a valid, moving tick that flows through
 * `appliedPercent` exactly like a real answer.
 */
export function sampleAuraPercent(): number {
  const magnitude = MIN_AURA_PERCENT + Math.random() * (MAX_AURA_PERCENT - MIN_AURA_PERCENT);
  const sign = Math.random() < 0.5 ? -1 : 1;
  return Math.round(sign * magnitude * 10) / 10;
}

/** The marked summary returned in place of a real AI memo (distinguishable). */
export function sampleAuraSummary(percent: number): string {
  const sign = percent >= 0 ? "+" : "";
  return `[debug] sampled ${sign}${percent.toFixed(1)}% (no AI call)`;
}

/** Text stand-in for a structured completion — clearly marked, no network. */
export const DEBUG_TEXT_SAMPLE = "[debug] sample completion (no AI call)";

/**
 * Tag a structured JSON sample so it is distinguishable from a real reply.
 * Non-object fallbacks are returned unchanged (there is nothing to mark).
 */
export function debugJsonSample<T>(fallback: T): T {
  if (fallback !== null && typeof fallback === "object") {
    return { ...(fallback as Record<string, unknown>), debug: true } as T;
  }
  return fallback;
}

/** One sample web-search hit — clearly marked and never fetched. */
export function sampleWebResults(query: string): {
  title: string;
  url: string;
  snippet: string;
}[] {
  return [
    {
      title: "[debug] sample result (no search)",
      url: "https://debug.local/",
      snippet: `[debug] no web search performed for "${query}"`,
    },
  ];
}
