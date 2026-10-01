/**
 * Oracle REST client — backend-owned data (posts, comments, social graph,
 * notifications, handle management) + wallet-JWT auth.
 *
 * Every social endpoint responds with the `{ ok, ts, data }` ApiResponse
 * envelope; `api()` unwraps it. Mutations require a JWT minted by
 * `POST /auth/login` (EIP-191 signMessage → HS256 token), stored per address.
 */
import { API_BASE } from "./privy";
import { isJwtStale } from "./jwt-stale";

const JWT_KEY = "aura.jwt";

export function getJwt(): string | null {
  try {
    return localStorage.getItem(JWT_KEY);
  } catch {
    return null;
  }
}

export function setJwt(token: string | null): void {
  try {
    if (token) localStorage.setItem(JWT_KEY, token);
    else localStorage.removeItem(JWT_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * Forget the oracle session on this device. Wallet disconnect and API session
 * teardown are independent — callers run both in parallel and never let one
 * failure block the other.
 */
export function clearJwt(): void {
  setJwt(null);
}

/**
 * True when the stored oracle token cannot serve the next call: missing,
 * malformed, or expiring within `skewSeconds` (default 60). Thin wrapper over
 * `isJwtStale` that defaults to the token on this device.
 */
export function jwtStale(token: string | null = getJwt(), skewSeconds = 60): boolean {
  return isJwtStale(token, skewSeconds);
}

/** Best-effort server-side session revoke. Never throws. */
export async function logoutApi(): Promise<void> {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    /* no logout endpoint / token already invalid — the local clear is enough */
  } finally {
    clearJwt();
  }
}

type Envelope<T> = { ok?: boolean; ts?: number; data?: T };

/** Raw fetch with the bearer token attached; throws on !ok. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.json !== undefined ? { "content-type": "application/json" } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const token = getJwt();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // 401 = the bearer is dead (expired/revoked): drop it so the next guarded
    // call re-mints instead of replaying a token the oracle will keep rejecting.
    if (res.status === 401) clearJwt();
    throw new Error(`Aura API ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as T & Envelope<T>;
  // Unwrap the structured envelope when present.
  if (json && typeof json === "object" && "ok" in json && "data" in json) {
    return (json as Envelope<T>).data as T;
  }
  return json;
}

/** EIP-191 login: sign the message with the wallet, mint the oracle JWT. */
export async function loginWithAddress(
  address: string,
  signMessage: (message: string) => Promise<string>,
): Promise<string> {
  const message = `Aura login\nAddress: ${address.toLowerCase()}\nNonce: ${Date.now()}`;
  const signature = await signMessage(message);
  const { token } = await api<{ token: string; address: string }>("/auth/login", {
    method: "POST",
    json: { message, signature, address },
  });
  setJwt(token);
  return token;
}
