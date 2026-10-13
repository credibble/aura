import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Inject } from "@nestjs/common";
import { createHash, createHmac, randomBytes } from "node:crypto";
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
 * What we round-trip through Supabase's `state` parameter: the account that
 * owns the connection, plus (best-effort) where to send the browser back to.
 * Supabase echoes `state` on the callback, so the oracle can finish the
 * exchange without trusting anything the browser tells it. `n` is a per-attempt
 * nonce — it makes each attempt's PKCE verifier distinct (see `verifierFor`).
 */
export type OAuthState = { account: string; returnTo?: string; n?: string };

/** Encode the state as a URL-safe token (base64url JSON). */
export function encodeOAuthState(state: OAuthState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

/**
 * Decode a state token. Tolerant of the legacy format where the whole state was
 * just the account string (pre-returnTo flows), so in-flight links don't break.
 */
export function decodeOAuthState(raw: string | null | undefined): OAuthState {
  if (!raw) return { account: "" };
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as OAuthState;
    if (parsed && typeof parsed.account === "string") return parsed;
  } catch {
    /* legacy: a bare account string */
  }
  return { account: raw };
}

/** Append the `connection=<platform>:<result>` flag to an app return URL. */
export function connectionResultUrl(returnTo: string, value: string): string {
  const url = new URL(returnTo);
  url.searchParams.set("connection", value);
  return url.toString();
}

/**
 * Browser shim for the error path. Supabase reports provider errors in the URL
 * *fragment* (`#error=…`), which never reaches the server — so instead of a 302
 * (which would drop it) we return a tiny page that forwards the fragment, plus a
 * `connection=<platform>:error` flag, to the app's return URL.
 */
export function oauthErrorPage(returnTo: string, platform: string): string {
  const target = JSON.stringify(returnTo);
  const flag = JSON.stringify(`connection=${encodeURIComponent(`${platform}:error`)}`);
  return (
    '<!doctype html><meta charset="utf-8"><title>Connecting…</title><script>(function(){' +
    `var base=${target};` +
    'var hash=window.location.hash.replace(/^#/,"");' +
    `var url=base+(base.indexOf("?")<0?"?":"&")+${flag};` +
    'if(hash)url+="&"+hash;' +
    "window.location.replace(url);" +
    "})();<\\/script>"
  );
}

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

  /** HMAC key behind the PKCE verifier. Any stable server secret works; the
   *  point is that an intercepted code can't be exchanged without it. */
  private pkceSecret(): string {
    return (
      this.config.get<string>("OAUTH_PKCE_SECRET") ??
      this.config.get<string>("AUTH_JWT_SECRET") ??
      this.config.get<string>("CONNECTION_ENCRYPTION_KEY") ??
      "aura-dev-pkce"
    );
  }

  /**
   * The PKCE `code_verifier` for a flow, derived from the (server-secret-signed)
   * state instead of being stored. 43 base64url chars — within PKCE's 43–128.
   * The same state always yields the same verifier, so `authUrl` and the
   * callback agree without server state.
   */
  verifierFor(state: string): string {
    return createHmac("sha256", this.pkceSecret()).update(state).digest("base64url");
  }

  /** The PKCE `code_challenge` = base64url(SHA256(verifier)). */
  private challengeFor(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url");
  }

  /**
   * Where to bounce the browser after the callback. Only an absolute http(s)
   * `returnTo` is honoured — anything else falls back to the configured app
   * origin, so a crafted `state` can't turn the callback into an open redirect.
   */
  returnUrl(raw?: string | null): string {
    if (raw && /^https?:\/\//i.test(raw)) return raw;
    return this.config.get<string>("APP_URL") ?? "http://localhost:5173";
  }

  /**
   * Build the Supabase Auth authorize URL for a social platform.
   *
   * `redirectTo` is where SUPABASE sends the browser back (the oracle's
   * `/connections/oauth/:platform/callback`, which does the code exchange);
   * `returnTo` is where the ORACLE then sends the browser (the app page). Both
   * go through `state` so the callback can trust them.
   *
   * We request the PKCE flow (`code_challenge`/`s256`): without it Supabase uses
   * the implicit flow and returns the tokens in the URL *fragment*
   * (`#access_token=…`), which a server never sees — there'd be no code to
   * exchange. With it, Supabase sends `?code=…&state=…` to the callback.
   */
  authUrl(
    platform: string,
    account: string,
    redirectTo: string,
    returnTo?: string,
  ): string | null {
    const provider = this.providerFor(platform);
    const base = this.config.get<string>("SUPABASE_URL");
    if (!provider || !base) return null;
    const state = encodeOAuthState({
      account,
      returnTo,
      n: randomBytes(16).toString("base64url"),
    });
    const query = new URLSearchParams({
      provider,
      redirect_to: redirectTo,
      scopes: this.scopesFor(platform),
      state,
      code_challenge: this.challengeFor(this.verifierFor(state)),
      code_challenge_method: "s256",
    });
    return `${base.replace(/\/$/, "")}/auth/v1/authorize?${query.toString()}`;
  }

  /**
   * Exchange the Supabase Auth callback code for a session, then store the
   * platform's provider token as a Connection. Returns the stored account.
   *
   * PKCE: `/token?grant_type=pkce` with the code + the verifier derived from the
   * same `state` we signed at authorize time.
   */
  async exchangeCode(
    platform: string,
    account: string,
    code: string,
    verifier: string,
  ): Promise<{ account: string }> {
    const base = this.config.get<string>("SUPABASE_URL");
    const serviceRole =
      this.config.get<string>("SUPABASE_SERVICE_ROLE_KEY") ??
      this.config.get<string>("SUPABASE_SECRET_KEY");
    if (!base || !serviceRole) throw new Error("Supabase not configured");
    const provider = this.providerFor(platform);
    if (!provider) throw new Error(`No Supabase OAuth provider for ${platform}`);

    const res = await fetch(`${base.replace(/\/$/, "")}/auth/v1/token?grant_type=pkce`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: serviceRole,
        authorization: `Bearer ${serviceRole}`,
      },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
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