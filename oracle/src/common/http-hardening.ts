import type { RequestHandler } from "express";

/**
 * Security headers without pulling in helmet: the handful that matter for a JSON
 * API, applied before any route. `x-powered-by` is removed so the stack isn't
 * advertised.
 */
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("cross-origin-opener-policy", "same-origin");
    res.setHeader("x-dns-prefetch-control", "off");
    res.setHeader("permissions-policy", "geolocation=(), microphone=(), camera=()");
    res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    res.removeHeader("x-powered-by");
    next();
  };
}

/**
 * CORS allow-list. `CORS_ORIGINS` is a comma-separated list; `*` (or anything
 * unset in non-production) keeps local development frictionless, but production
 * without an explicit list refuses every unknown origin instead of echoing it.
 */
export function corsOptions(
  rawOrigins: string | undefined,
  nodeEnv: string | undefined,
): { origin: true | string[] } {
  const list = (rawOrigins ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (list.includes("*")) return { origin: true };
  if (list.length > 0) return { origin: list };
  if (nodeEnv === "production") return { origin: [] };
  return { origin: true };
}
