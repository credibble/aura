/** Shared HTTP helpers for the source providers (Node 22+ global fetch). */

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT = 15_000;

/** fetch with an abort timeout; rejects on non-2xx. */
export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "AuraOracle/0.1 (prediction-handle sentiment engine)",
        accept: "application/json, application/rss+xml, application/xml, text/xml, text/html",
        ...options.headers,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** fetch + JSON parse. */
export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, options);
  return JSON.parse(text) as T;
}