/**
 * Portfolio lib — the oracle backend client for the portfolio page.
 * Backed by the oracle NestJS API (/v1/...) which reads on-chain handles via
 * the indexer. 404 = "no connection row" (null); anything else throws.
 */
import { API_BASE } from "./privy";

export type HandleLink = {
  id: string;
  name: string;
  symbol: string;
  aura: number;
  sources: string[];
  stake: string;
  pool: string;
  /** Handle contract address — creator revenue reads/claims target it. */
  contract: string;
};

export type ConnectionLink = {
  handleId: string;
  platform: string | null;
  account: string | null;
  status: "connected" | "reconnecting" | "disconnected";
};

/** Aura needed to graduate a handle to trading prediction. */
export const GRADUATION_AURA = 100;

/** The protocol fee curve (matches the on-chain Configurator defaults). */
export const FEE_CURVE = { minBps: 25, maxBps: 250, maxFeeAura: 999_999 };

/** Deposit fee bps for a handle's aura: 0 at 0, floored at 0.25%, capped at 2.5%. */
export function depositFeeBps(aura: number): number {
  if (aura <= 0) return 0;
  const scaled = Math.round((aura * FEE_CURVE.maxBps) / FEE_CURVE.maxFeeAura);
  return Math.max(FEE_CURVE.minBps, Math.min(FEE_CURVE.maxBps, scaled));
}

async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Aura API ${res.status}: ${await res.text().catch(() => "")}`);
  return (await res.json()) as T;
}

export const portfolio = {
  /** The handle's single source connection. */
  connection: (handleId: string): Promise<ConnectionLink | null> =>
    api(`/handles/${handleId}/connection`),

  /** Connect / reconnect / disconnect. */
  connect: (
    handleId: string,
    platform: string,
    account: string,
    reconnect = false,
  ): Promise<ConnectionLink | null> =>
    api(`/handles/${handleId}/connection`, {
      method: "PUT",
      body: JSON.stringify({ platform, account, reconnect }),
    }),
  disconnect: (handleId: string): Promise<ConnectionLink | null> =>
    api(`/handles/${handleId}/connection`, { method: "DELETE" }),

  /**
   * Update a handle's profile. Multipart: `name`, `symbol` and an optional
   * `photo` FILE — the oracle uploads the image and signs the metadata write, so
   * the frontend never sends a URL or holds the contract's owner rights.
   * `label` is the handle's name (lowercase), which is also its URL slug.
   */
  async updateHandle(
    label: string,
    input: { name?: string; symbol?: string; photo?: File | null },
  ): Promise<{ handleId: string; label: string; address: string; tx: string } | null> {
    const fd = new FormData();
    if (input.name) fd.append("name", input.name);
    if (input.symbol) fd.append("symbol", input.symbol);
    if (input.photo) fd.append("photo", input.photo);
    const res = await fetch(`${API_BASE}/handles/${encodeURIComponent(label)}`, {
      method: "PATCH",
      body: fd,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Aura API ${res.status}: ${await res.text().catch(() => "")}`);
    return (await res.json()) as { handleId: string; label: string; address: string; tx: string };
  },
};
