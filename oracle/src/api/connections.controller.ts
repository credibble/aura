import { Body, Controller, Delete, Get, Inject, Logger, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { CONNECTION_STORE } from "../core/ports/tokens";
import type { IConnectionStore } from "../core/ports/connection-store";
import type { AdapterCredentials } from "../core/domain/source";
import {
  SupabaseAuthService,
  connectionResultUrl,
  decodeOAuthState,
  OAUTH_STATE_PARAM,
  oauthErrorPage,
} from "../auth/supabase-auth.service";
import { ShopifyAuthService } from "../auth/shopify-auth.service";
import { PortfolioService } from "./portfolio.service";

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
    private readonly portfolio: PortfolioService,
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
   * this URL as `redirect_to`, with our flow payload on its query string). We
   * exchange the code for the provider token, store it, LINK the handle to it,
   * then bounce the browser back to the app.
   *
   * The link is the missing half otherwise: `exchangeCode` only writes the
   * credential (`connections`); the UI reads the handle's single connection row
   * (`handle_connections`) via `GET /handles/:id/connection`, so without this the
   * toast says "connected" while the row stays empty. The app passes the handle
   * id as `account`, so it doubles as the handle id here — same value the
   * credential is keyed under.
   *
   * The payload is NOT in `state`: GoTrue reserves `state` for its own flow and
   * drops the client value, so it rides on `redirect_to`'s `?c=` instead (see
   * `OAUTH_STATE_PARAM`).
   *
   * On error Supabase puts the details in the URL *fragment* (invisible to the
   * server), so the no-code path returns a tiny page that forwards it onward.
   */
  @Get("oauth/:platform/callback")
  async oauthCallback(
    @Param("platform") platform: string,
    @Query("code") code: string,
    @Query(OAUTH_STATE_PARAM) state: string,
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
        this.supabase.verifierFor(state ?? ""),
      );
      // Link the handle to the stored credential so the UI reflects it.
      await this.portfolio.connect(account, platform, account);
      res.redirect(302, connectionResultUrl(back, `${platform}:connected`));
    } catch (e) {
      this.logger.warn(`OAuth exchange failed for ${platform}: ${(e as Error).message}`);
      res.redirect(302, connectionResultUrl(back, `${platform}:error`));
    }
  }

  /**
   * Start the Shopify OAuth flow for a merchant store. `redirectTo` is the ORACLE
   * callback (registered in the Shopify app); `account` is the handle to link and
   * `returnTo` the app page to land on — both round-trip through Shopify's
   * echoed `state`.
   */
  @Get("shopify/auth-url")
  async shopifyUrl(
    @Query("shop") shop: string,
    @Query("redirectTo") redirectTo: string,
    @Query("returnTo") returnTo: string,
    @Query("account") account: string,
  ): Promise<{ url: string | null }> {
    return { url: this.shopify.authUrl(shop, redirectTo, account, returnTo) };
  }

  /**
   * Shopify redirects HERE after the merchant approves. Verify the `hmac`,
   * exchange `shop`+`code` for the permanent token, link the handle, then bounce
   * the browser back to the app (mirrors {@link oauthCallback} for social).
   */
  @Get("shopify/callback")
  async shopifyCallback(
    @Req() req: Request,
    @Query("code") code: string,
    @Query("shop") shop: string,
    @Query("state") state: string,
    @Query("hmac") hmac: string,
    @Res() res: Response,
  ): Promise<void> {
    const { account: handleId, returnTo } = this.shopify.decodeState(state);
    const back = this.supabase.returnUrl(returnTo);
    try {
      if (!this.shopify.verifyHmac(req.query as Record<string, unknown>, hmac)) {
        throw new Error("Shopify hmac verification failed");
      }
      if (!code || !shop) throw new Error("Shopify callback missing code/shop");
      const { account } = await this.shopify.exchangeCode(shop, code);
      await this.portfolio.connect(handleId, "shopify", account);
      res.redirect(302, connectionResultUrl(back, "shopify:connected"));
    } catch (e) {
      this.logger.warn(`Shopify OAuth failed: ${(e as Error).message}`);
      res.redirect(302, connectionResultUrl(back, "shopify:error"));
    }
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