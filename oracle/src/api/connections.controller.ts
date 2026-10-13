import { Body, Controller, Delete, Get, Inject, Logger, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { CONNECTION_STORE } from "../core/ports/tokens";
import type { IConnectionStore } from "../core/ports/connection-store";
import type { AdapterCredentials } from "../core/domain/source";
import {
  SupabaseAuthService,
  connectionResultUrl,
  decodeOAuthState,
  oauthErrorPage,
} from "../auth/supabase-auth.service";
import { ShopifyAuthService } from "../auth/shopify-auth.service";

/**
 * Connections — where adapters get their platform credentials. Secrets NEVER
 * live on-chain: OAuth is facilitated through Supabase Auth for social
 * platforms (Spotify, Instagram, X, ...) and the provider tokens land AES-
 * 256-GCM encrypted in Postgres (the only connection store — no Redis); API
 * keys can be registered manually.
 */
@Controller("v1/connections")
export class ConnectionsController {
  constructor(
    @Inject(CONNECTION_STORE) private readonly store: IConnectionStore,
    private readonly supabase: SupabaseAuthService,
    private readonly shopify: ShopifyAuthService,
  ) {}

  private readonly logger = new Logger(ConnectionsController.name);

  /** Start the Supabase-facilitated OAuth flow for a social platform. */
  @Get("oauth/:platform/auth-url")
  async oauthUrl(
    @Param("platform") platform: string,
    @Query("account") account: string,
    @Query("redirectTo") redirectTo: string,
    @Query("returnTo") returnTo: string,
  ): Promise<{ url: string | null; provider: string | null }> {
    return {
      url: this.supabase.authUrl(platform, account, redirectTo, returnTo),
      provider: this.supabase.providerFor(platform),
    };
  }

  /**
   * Supabase sends the browser HERE after the user authorizes (the app passes
   * this URL as `redirect_to`). We exchange the code for the provider token and
   * store it, then bounce the browser back to the app.
   *
   * On error Supabase puts the details in the URL *fragment* (invisible to the
   * server), so the no-code path returns a tiny page that forwards it onward.
   */
  @Get("oauth/:platform/callback")
  async oauthCallback(
    @Param("platform") platform: string,
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() res: Response,
  ): Promise<void> {
    const { account, returnTo } = decodeOAuthState(state);
    const back = this.supabase.returnUrl(returnTo);
    if (!code) {
      res.status(200).type("html").send(oauthErrorPage(back, platform));
      return;
    }
    try {
      await this.supabase.exchangeCode(
        platform,
        account,
        code,
        this.supabase.verifierFor(state),
      );
      res.redirect(302, connectionResultUrl(back, `${platform}:connected`));
    } catch (e) {
      this.logger.warn(`OAuth exchange failed for ${platform}: ${(e as Error).message}`);
      res.redirect(302, connectionResultUrl(back, `${platform}:error`));
    }
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