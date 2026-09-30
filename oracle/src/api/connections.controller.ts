import { Body, Controller, Delete, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { CONNECTION_STORE } from "../core/ports/tokens";
import type { IConnectionStore } from "../core/ports/connection-store";
import type { AdapterCredentials } from "../core/domain/source";
import { SupabaseAuthService } from "../auth/supabase-auth.service";
import { ShopifyAuthService } from "../auth/shopify-auth.service";

/**
 * Connections — where adapters get their platform credentials. Secrets NEVER
 * live on-chain: OAuth is facilitated through Supabase Auth for social
 * platforms (Spotify, Instagram, X, ...) and the provider tokens land AES-
 * 256-GCM encrypted in Postgres (the only connection store — no Redis); API
 * keys can be registered manually.
 */
@Controller("connections")
export class ConnectionsController {
  constructor(
    @Inject(CONNECTION_STORE) private readonly store: IConnectionStore,
    private readonly supabase: SupabaseAuthService,
    private readonly shopify: ShopifyAuthService,
  ) {}

  /** Start the Supabase-facilitated OAuth flow for a social platform. */
  @Get("oauth/:platform/auth-url")
  async oauthUrl(
    @Param("platform") platform: string,
    @Query("account") account: string,
    @Query("redirectTo") redirectTo: string,
  ): Promise<{ url: string | null; provider: string | null }> {
    return {
      url: this.supabase.authUrl(platform, account, redirectTo),
      provider: this.supabase.providerFor(platform),
    };
  }

  /** Supabase redirects here after the user authorizes — exchange + store. */
  @Get("oauth/:platform/callback")
  async oauthCallback(
    @Param("platform") platform: string,
    @Query("code") code: string,
    @Query("state") state: string,
  ): Promise<{ account: string; connected: boolean }> {
    const { account } = await this.supabase.exchangeCode(platform, state, code);
    return { account, connected: true };
  }

  /** Start the Shopify OAuth flow for a merchant store. */
  @Get("shopify/auth-url")
  async shopifyUrl(
    @Query("shop") shop: string,
    @Query("redirectTo") redirectTo: string,
  ): Promise<{ url: string | null }> {
    return { url: this.shopify.authUrl(shop, redirectTo) };
  }

  /** Shopify redirects here after the merchant approves — exchange + store. */
  @Get("shopify/callback")
  async shopifyCallback(
    @Query("code") code: string,
    @Query("shop") shop: string,
  ): Promise<{ account: string; connected: boolean }> {
    return this.shopify.exchangeCode(shop, code);
  }

  /** Register/update a platform account's credentials (manual API key). */
  @Post(":platform/:account")
  async set(
    @Param("platform") platform: string,
    @Param("account") account: string,
    @Body() credentials: AdapterCredentials,
  ): Promise<{ ok: true }> {
    await this.store.set(platform, account, credentials);
    return { ok: true };
  }

  @Get(":platform")
  async accounts(@Param("platform") platform: string): Promise<{ account: string; connected: boolean }[]> {
    const rows = await this.store.accounts(platform);
    return rows.map((r) => ({ account: r.account, connected: Boolean(r.accessToken ?? r.apiKey) }));
  }

  @Get(":platform/:account")
  async get(
    @Param("platform") platform: string,
    @Param("account") account: string,
  ): Promise<{ account: string; connected: boolean }> {
    const credentials = await this.store.get(platform, account);
    return { account, connected: Boolean(credentials?.accessToken ?? credentials?.apiKey) };
  }

  @Delete(":platform/:account")
  async remove(
    @Param("platform") platform: string,
    @Param("account") account: string,
  ): Promise<{ ok: true }> {
    await this.store.remove(platform, account);
    return { ok: true };
  }
}