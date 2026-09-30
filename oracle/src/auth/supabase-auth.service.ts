import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Inject } from "@nestjs/common";
import type { IConnectionStore } from "../core/ports/connection-store";
import { CONNECTION_STORE } from "../core/ports/tokens";
import type { AdapterCredentials } from "../core/domain/source";

/** Supabase Auth OAuth providers it actually supports — the social platforms
 *  we can facilitate. (Supabase: Facebook, GitHub, LinkedIn (OIDC), Twitch,
 *  X/Twitter (OAuth 2.0), Spotify.) */
const SUPABASE_PROVIDERS: Readonly<Record<string, string>> = {
  spotify: "spotify",
  x: "twitter",
  twitch: "twitch",
  facebook: "facebook",
  github: "github",
  linkedin: "linkedin",
};

/**
 * Supabase-facilitated OAuth for social connections. Supabase Auth runs the
 * OAuth dance for the providers it supports (Spotify, Facebook, GitHub,
 * LinkedIn, Twitch, X/Twitter); the resulting PROVIDER tokens (access +
 * refresh) land in our ConnectionStore
 * (Redis + Postgres), which adapters read at fetch time. Secrets never touch
 * the chain.
 */
@Injectable()
export class SupabaseAuthService {
  private readonly logger = new Logger(SupabaseAuthService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(CONNECTION_STORE) private readonly store: IConnectionStore,
  ) {}

  /** The Supabase OAuth provider id for a platform, or null (not social). */
  providerFor(platform: string): string | null {
    return SUPABASE_PROVIDERS[platform] ?? null;
  }

  /** Build the Supabase Auth authorize URL for a social platform. */
  authUrl(platform: string, account: string, redirectTo: string): string | null {
    const provider = this.providerFor(platform);
    const base = this.config.get<string>("SUPABASE_URL");
    if (!provider || !base) return null;
    const query = new URLSearchParams({
      provider,
      redirect_to: redirectTo,
      scopes: this.scopesFor(platform),
    });
    // Carry the account through the callback via the state param.
    query.set("state", account);
    return `${base.replace(/\/$/, "")}/auth/v1/authorize?${query.toString()}`;
  }

  /**
   * Exchange the Supabase Auth callback code for a session, then store the
   * platform's provider token as a Connection. Returns the stored account.
   */
  async exchangeCode(platform: string, account: string, code: string): Promise<{ account: string }> {
    const base = this.config.get<string>("SUPABASE_URL");
    const serviceRole =
      this.config.get<string>("SUPABASE_SERVICE_ROLE_KEY") ??
      this.config.get<string>("SUPABASE_SECRET_KEY");
    if (!base || !serviceRole) throw new Error("Supabase not configured");
    const provider = this.providerFor(platform);
    if (!provider) throw new Error(`No Supabase OAuth provider for ${platform}`);

    const res = await fetch(`${base.replace(/\/$/, "")}/auth/v1/token?grant_type=authorization_code`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: serviceRole,
        authorization: `Bearer ${serviceRole}`,
      },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`supabase token HTTP ${res.status}`);
    const session = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      provider_token?: string;
      provider_refresh_token?: string;
    };

    const credentials: AdapterCredentials = {
      accessToken: session.provider_token ?? session.access_token,
      refreshToken: session.provider_refresh_token ?? session.refresh_token,
      account,
    };
    if (!credentials.accessToken) throw new Error("No provider token in Supabase session");
    await this.store.set(platform, account, credentials);
    this.logger.log(`Connected ${platform}::${account} via Supabase OAuth`);
    return { account };
  }

  /** OAuth scopes per platform (Supabase passes them through to the provider). */
  private scopesFor(platform: string): string {
    switch (platform) {
      case "spotify":
        return "user-read-email user-read-private";
      case "x":
        return "users.read tweet.read offline.access";
      case "facebook":
        return "public_profile pages_show_list";
      case "github":
        return "read:user user:email";
      case "linkedin":
        return "openid profile email";
      case "twitch":
        return "user:read:email";
      default:
        return "";
    }
  }
}