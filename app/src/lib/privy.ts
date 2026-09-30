/**
 * Privy integration (bounty: "Integrate Privy beyond authentication").
 *
 * We go BEYOND login: the Privy embedded wallet is the signer for the whole
 * Aura trading + staking flow — IndexMarket buys/sells/claims, order-book
 * fills, AURA Stake deposits/withdrawals, and handle claiming. This module
 * wraps @privy-io/react-auth + the Embedded Wallet provider and exposes a
 * `useAuraAuth()` hook that couples the Privy user to the oracle backend
 * (handles, connections, social).
 */

export const PRIVY_APP_ID = (import.meta.env.VITE_PRIVY_APP_ID ?? "") as string;

/** The oracle API base (NestJS). Defaults to the local dev gateway. */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:4000/v1") as string;

export type AuthState = {
  /** Privy user id (uuid). */
  userId: string | null;
  /** Wallet address (Privy embedded wallet). */
  address: string | null;
  email: string | null;
  ready: boolean;
};

export type ConnectionLink = {
  handleId: string;
  platform: string | null;
  account: string | null;
  status: "connected" | "reconnecting" | "disconnected";
};

export type HandleAvailability = {
  available: boolean;
  reason: "reserved" | "claimed" | "unverified" | "available";
  claimedBy?: string;
  verification?: Verification;
};

/** Cleanverse CVI verification (wallet-level A-Pass status). */
export type Verification = {
  verified: boolean;
  credential: "A-Pass";
  tier: string | null;
  did: string | null;
  address: string;
};

/** Handle verification result: wallet CVI status + the on-chain flag. */
export type HandleVerifyResult = {
  verification: Verification;
  verifiedOnChain: boolean | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`Aura API ${res.status}: ${await res.text().catch(() => "")}`);
  return (await res.json()) as T;
}

/** Oracle backend calls driven by the logged-in Privy wallet. */
export const aura = {
  /** Claim availability with the creator's CVI verification. */
  availability: (name: string, address: string): Promise<HandleAvailability> =>
    api(
      `/handles/availability/check?name=${encodeURIComponent(name)}&address=${encodeURIComponent(address)}`,
    ),

  /** CVI identity verification status for the wallet. */
  verify: (address: string): Promise<Verification> =>
    api(`/handles/verify?address=${encodeURIComponent(address)}`),

  /** Frontend → backend → onchain: verify the handle's creator (Cleanverse)
   *  and write Handle.setVerified on-chain. */
  verifyHandle: (handleId: string): Promise<HandleVerifyResult> =>
    api(`/handles/${encodeURIComponent(handleId)}/verify`, { method: "POST" }),

  /** Current on-chain Handle.verified flag (drives the UI badge). */
  handleVerified: (handleId: string): Promise<{ verified: boolean | null }> =>
    api(`/handles/${encodeURIComponent(handleId)}/verified`),

  /** Connect / reconnect / disconnect the handle's single source connection. */
  connection: (handleId: string): Promise<ConnectionLink> => api(`/handles/${handleId}/connection`),
  connect: (
    handleId: string,
    platform: string,
    account: string,
    reconnect = false,
  ): Promise<ConnectionLink> =>
    api(`/handles/${handleId}/connection`, {
      method: "PUT",
      body: JSON.stringify({ platform, account, reconnect }),
    }),
  disconnect: (handleId: string): Promise<ConnectionLink> =>
    api(`/handles/${handleId}/connection`, { method: "DELETE" }),

  /** Social: follow / subscribe / like / repost with the user id. */
  follow: (userId: string, handleId: string) =>
    api("/social/follow", { method: "POST", body: JSON.stringify({ userId, handleId }) }),
  subscribe: (userId: string, handleId: string) =>
    api("/social/subscribe", { method: "POST", body: JSON.stringify({ userId, handleId }) }),
  like: (userId: string, targetId: string, targetType: "feed" | "window" | "handle") =>
    api("/social/like", { method: "POST", body: JSON.stringify({ userId, targetId, targetType }) }),
  repost: (userId: string, eventId: string) =>
    api("/social/repost", { method: "POST", body: JSON.stringify({ userId, eventId }) }),
  notifications: (userId: string) => api(`/social/${encodeURIComponent(userId)}/notifications`),
};

/** Privy OAuth URLs for social connections (Supabase-facilitated). */
export const oauthUrl = (platform: string, account: string, redirectTo: string): string =>
  `${API_BASE}/connections/oauth/${platform}/auth-url?account=${encodeURIComponent(account)}&redirectTo=${encodeURIComponent(redirectTo)}`;

export const shopifyUrl = (shop: string, redirectTo: string): string =>
  `${API_BASE}/connections/shopify/auth-url?shop=${encodeURIComponent(shop)}&redirectTo=${encodeURIComponent(redirectTo)}`;
