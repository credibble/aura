/**
 * The percent band every aura tick's applied move sits inside: a floor so the
 * index always moves (no dead ticks) and a ceiling so one tick can't reprice the
 * whole market. The AI's magnitude is advisory and this band clamps it.
 *
 * It lives in its own module so the engine and the DEBUG_MODE sampler
 * (`config/debug.ts`) draw from one source of truth — a debug tick must be a
 * valid, moving tick, indistinguishable in band from a real one.
 */
export const MIN_AURA_PERCENT = 5;
export const MAX_AURA_PERCENT = 20;
