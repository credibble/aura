import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Inject } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IConnectionStore } from "../core/ports/connection-store";
import { CONNECTION_STORE } from "../core/ports/tokens";
import { decodeOAuthState, encodeOAuthState } from "./supabase-auth.service";

/** Scopes requested from the merchant when they connect their store. */
const SHOPIFY_SCOPES = "read_orders,read_customers,read_products,read_inventory,read_discounts";

/** `my-store.myshopify.com` (or a URL) → `my-store` — the shop's own handle. */
function cleanShop(shop: string): string {
  return shop
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.myshopify\.com$/, "");
}

/**
 * Shopify OAuth — lets a merchant "Connect Shopify" on the portfolio page:
 *   authorize → merchant approves read_orders/read_customers/read_products/
 *               read_inventory on their store
 *   callback  → exchange the code for a PERMANENT access token, stored
 *               AES-256-GCM encrypted in Postgres (the only connection store
 *               — no Redis) so the ShopifyAdapter can read
 *               sales/orders/customers/products via the Admin API.
 * The token is never on-chain.
 *
 * Unlike Supabase, Shopify echoes our `state` back untouched, so the oracle's
 * callback (where `redirect_uri` points) round-trips `{account, returnTo}` — the
 * handle to link + the app page to land on — through `state`.
 */
@Injectable()
export class ShopifyAuthService {
  private readonly logger = new Logger(ShopifyAuthService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(CONNECTION_STORE) private readonly store: IConnectionStore,
  ) {}

  /**
   * Build the Shopify OAuth authorize URL for a merchant store.
   *
   * `redirectTo` is the ORACLE callback (registered in the Shopify app), and
   * `state` carries the handle to link + the app page to return to. `account`
   * defaults to the shop, so a bare call still round-trips a usable value.
   */
  authUrl(shop: string, redirectTo: string, account?: string, returnTo?: string): string | null {
    const clientId = this.config.get<string>("SHOPIFY_CLIENT_ID");
    if (!clientId) return null;
    const clean = cleanShop(shop);
    const state = encodeOAuthState({ account: account ?? clean, returnTo });
    const query = new URLSearchParams({
      client_id: clientId,
      scope: SHOPIFY_SCOPES,
      redirect_uri: redirectTo,
      state,
    });
    return `https://${clean}.myshopify.com/admin/oauth/authorize?${query.toString()}`;
  }

  /**
   * Verify Shopify's `hmac`: sort every query param except `hmac` as `k=v`,
   * join with `&`, HMAC-SHA256 with the app secret, timing-safe compare. Without
   * this an attacker could forge a callback and plant a store token.
   */
  verifyHmac(query: Record<string, unknown>, hmac?: string): boolean {
    const secret = this.config.get<string>("SHOPIFY_CLIENT_SECRET");
    if (!secret || !hmac) return false;
    const message = Object.keys(query)
      .filter((k) => k !== "hmac" && k !== "signature")
      .sort()
      .map((k) => {
        const v = query[k];
        return `${k}=${Array.isArray(v) ? v.join(",") : String(v ?? "")}`;
      })
      .join("&");
    const expected = createHmac("sha256", secret).update(message).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(hmac, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Exchange the OAuth code for a permanent access token and store it. */
  async exchangeCode(shop: string, code: string): Promise<{ account: string; connected: boolean }> {
    const clientId = this.config.get<string>("SHOPIFY_CLIENT_ID");
    const clientSecret = this.config.get<string>("SHOPIFY_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("Shopify app not configured");
    const clean = cleanShop(shop);

    const res = await fetch(`https://${clean}.myshopify.com/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`shopify oauth HTTP ${res.status}`);
    const token = (await res.json()) as { access_token?: string };

    if (!token.access_token) throw new Error("No access_token in Shopify OAuth response");
    await this.store.set("shopify", clean, { accessToken: token.access_token, account: clean });
    this.logger.log(`Connected shopify::${clean} via Shopify OAuth`);
    return { account: clean, connected: true };
  }

  /** Decode the `{account, returnTo}` payload Shopify echoed through `state`. */
  decodeState(state?: string | null): { account: string; returnTo?: string } {
    return decodeOAuthState(state);
  }
}