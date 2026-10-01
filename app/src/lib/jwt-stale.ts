/**
 * When the oracle JWT can no longer serve the next guarded call. The oracle
 * mints HS256 tokens with a 24 h TTL, so the app has to re-mint *before* the
 * expiry lands instead of replaying a dead bearer until it 401s.
 *
 * Decoding the payload here is not a trust decision — the oracle still verifies
 * the signature on every request — it only avoids a doomed round-trip. This is
 * a pure function of its inputs so it can be tested at a fixed clock.
 */

/** Decode a JWT payload (base64url) WITHOUT verifying the signature. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  // base64url → base64, pad, then decode as UTF-8 (a payload may carry non-ASCII).
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const json = new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
  const parsed: unknown = JSON.parse(json);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
}

/**
 * True when `token` cannot serve the next call: missing, malformed, or expiring
 * within `skewSeconds` (default 60). The boundary is inclusive — a token whose
 * `exp - now === skewSeconds` is already treated as stale. `nowSeconds` is
 * passed in (seconds since epoch) so the decision stays a pure function.
 */
export function isJwtStale(
  token: string | null | undefined,
  skewSeconds = 60,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!token) return true;
  let exp: unknown;
  try {
    exp = decodeJwtPayload(token)?.exp;
  } catch {
    return true;
  }
  if (typeof exp !== "number" || !Number.isFinite(exp)) return true;
  return exp - nowSeconds <= skewSeconds;
}
