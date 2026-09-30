import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Inject } from "@nestjs/common";
import type { IConnectionStore } from "../core/ports/connection-store";
import { CONNECTION_STORE } from "../core/ports/tokens";

/** Scopes requested from the merchant when they connect their store. */
const SHOPIFY_SCOPES = "read_orders,read_customers,read_products,read_inventory,read_discounts";

/**
 * Shopify OAuth — lets a merchant "Connect Shopify" on the portfolio page:
 *   authorize → merchant approves read_orders/read_customers/read_products/
 *               read_inventory on their store
 *   callback  → exchange the code for a PERMANENT access token, stored
 *               AES-256-GCM encrypted in Postgres (the only connection store
 *               — no Redis) so the ShopifyAdapter can read
 *               sales/orders/customers/products via the Admin API.
 * The token is never on-chain.
 */
@Injectable()
export class ShopifyAuthService {
  private readonly logger = new Logger(ShopifyAuthService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(CONNECTION_STORE) private readonly store: IConnectionStore,
  ) {}

  /** Build the Shopify OAuth authorize URL for a merchant store. */
  authUrl(shop: string, redirectTo: string): string | null {
    const clientId = this.config.get<string>("SHOPIFY_CLIENT_ID");
    if (!clientId) return null;
    const clean = shop.replace(/\.myshopify\.com$/, "");
    const query = new URLSearchParams({
      client_id: clientId,
      scope: SHOPIFY_SCOPES,
      redirect_uri: redirectTo,
      state: clean,
    });
    return `https://${clean}.myshopify.com/admin/oauth/authorize?${query.toString()}`;
  }

  /** Exchange the OAuth code for a permanent access token and store it. */
  async exchangeCode(shop: string, code: string): Promise<{ account: string; connected: boolean }> {
    const clientId = this.config.get<string>("SHOPIFY_CLIENT_ID");
    const clientSecret = this.config.get<string>("SHOPIFY_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("Shopify app not configured");
    const clean = shop.replace(/\.myshopify\.com$/, "");

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
}