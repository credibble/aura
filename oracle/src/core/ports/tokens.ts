/**
 * NestJS DI tokens for the core ports. Interfaces erase at runtime, so ports
 * are injected through stable symbols �?" this is what makes swapping the
 * Postgres store for the in-memory one (or a live model for a fake) a
 * one-line change in tests.
 */
export const HANDLE_REGISTRY = Symbol("HANDLE_REGISTRY");
export const SOURCE_REGISTRY = Symbol("SOURCE_REGISTRY");
export const SCORE_STORE = Symbol("SCORE_STORE");
export const AI_MODEL = Symbol("AI_MODEL");
export const AI_FETCH = Symbol("AI_FETCH");
export const SOURCE_STORE = Symbol("SOURCE_STORE");
export const TIME_SERIES_STORE = Symbol("TIME_SERIES_STORE");
export const ADAPTER_REGISTRY = Symbol("ADAPTER_REGISTRY");
export const CONNECTION_STORE = Symbol("CONNECTION_STORE");