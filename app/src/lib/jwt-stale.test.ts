/**
 * The staleness check decides when the app re-mints the oracle JWT. Get it
 * wrong and a dead bearer is replayed until every guarded call 401s; get it too
 * eager and the wallet signs on every request. Pin it at the boundaries.
 *
 *   node --test src/lib/jwt-stale.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isJwtStale } from "./jwt-stale.ts";

/** A fixed clock (seconds since epoch) so every case is deterministic. */
const NOW = 1_700_000_000;

/**
 * Build a JWT-shaped token from a payload, encoding with base64url by hand so
 * the test needs no JWT dependency. The signature is irrelevant: the check only
 * ever reads the payload.
 */
function tokenWithPayload(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.test-signature`;
}

test("a missing token is stale", () => {
  assert.equal(isJwtStale(null, 60, NOW), true);
  assert.equal(isJwtStale(undefined, 60, NOW), true);
  assert.equal(isJwtStale("", 60, NOW), true);
});

test("a malformed token is stale", () => {
  assert.equal(isJwtStale("not-a-jwt", 60, NOW), true);
  assert.equal(isJwtStale("only.two", 60, NOW), true);
  assert.equal(isJwtStale("a.!!!not-base64!!!.c", 60, NOW), true);
  // Valid JWT shape but the payload carries no usable exp.
  assert.equal(isJwtStale(tokenWithPayload({ sub: "0xabc" }), 60, NOW), true);
  assert.equal(isJwtStale(tokenWithPayload({ exp: "later" }), 60, NOW), true);
});

test("an expired token is stale", () => {
  assert.equal(isJwtStale(tokenWithPayload({ exp: NOW - 10 }), 60, NOW), true);
  assert.equal(isJwtStale(tokenWithPayload({ exp: NOW }), 60, NOW), true);
});

test("a token expiring inside the skew is stale", () => {
  assert.equal(isJwtStale(tokenWithPayload({ exp: NOW + 30 }), 60, NOW), true);
  // The boundary is inclusive: exp - now === skew is already stale.
  assert.equal(isJwtStale(tokenWithPayload({ exp: NOW + 60 }), 60, NOW), true);
  // A custom skew widens the window.
  assert.equal(isJwtStale(tokenWithPayload({ exp: NOW + 300 }), 600, NOW), true);
});

test("a comfortably fresh token is usable", () => {
  assert.equal(isJwtStale(tokenWithPayload({ exp: NOW + 61 }), 60, NOW), false);
  assert.equal(isJwtStale(tokenWithPayload({ exp: NOW + 3600 }), 60, NOW), false);
  // Outside a custom skew.
  assert.equal(isJwtStale(tokenWithPayload({ exp: NOW + 300 }), 0, NOW), false);
});
