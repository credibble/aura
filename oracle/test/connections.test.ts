import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PrismaConnectionStore } from "../src/persistence/prisma-connection-store.service";
import {
  SupabaseAuthService,
  connectionResultUrl,
  decodeOAuthState,
  encodeOAuthState,
  OAUTH_STATE_PARAM,
  oauthErrorPage,
} from "../src/auth/supabase-auth.service";
import { ShopifyAuthService } from "../src/auth/shopify-auth.service";

/** Fake Prisma `connection` delegate for the store tests. */
class FakeConnectionModel {
  private rows: {
    id: string;
    platform: string;
    account: string;
    accessToken: string | null;
    refreshToken: string | null;
    secrets: unknown;
  }[] = [];

  async findUnique(args: { where: { id: string } }): Promise<unknown> {
    return this.rows.find((r) => r.id === args.where.id) ?? null;
  }

  async findMany(args: { where: { platform: string } }): Promise<unknown[]> {
    return this.rows.filter((r) => r.platform === args.where.platform);
  }

  async upsert(args: {
    where: { id: string };
    create: {
      id: string;
      platform: string;
      account: string;
      accessToken: string | null;
      refreshToken: string | null;
      secrets: unknown;
    };
    update: {
      accessToken: string | null;
      refreshToken: string | null;
      secrets: unknown;
    };
  }): Promise<unknown> {
    const existing = this.rows.find((r) => r.id === args.where.id);
    if (existing) Object.assign(existing, args.update);
    else this.rows.push({ ...args.create });
    return args.create;
  }

  async delete(args: { where: { id: string } }): Promise<unknown> {
    this.rows = this.rows.filter((r) => r.id !== args.where.id);
    return null;
  }

  /** Raw row as stored — used to assert credentials are encrypted at rest. */
  peek(
    id: string,
  ):
    | {
        accessToken: string | null;
        refreshToken: string | null;
        secrets: unknown;
      }
    | undefined {
    return this.rows.find((r) => r.id === id);
  }
}

function store(
  prisma: unknown = { connection: new FakeConnectionModel() },
): PrismaConnectionStore {
  return new PrismaConnectionStore(
    prisma as never,
    {
      get: (k: string) =>
        k === "CONNECTION_ENCRYPTION_KEY" ? "test-passphrase" : undefined,
    } as never,
  );
}

describe("ConnectionStore — adapter credentials (OAuth / API keys), never on-chain", () => {
  it("stores and resolves credentials by (platform, account)", async () => {
    const s = store();
    await s.set("spotify", "taylorswift", {
      accessToken: "tok-123",
      refreshToken: "ref-456",
      account: "taylorswift",
    });

    const creds = await s.get("spotify", "taylorswift");
    expect(creds?.accessToken).toBe("tok-123");
    expect(creds?.refreshToken).toBe("ref-456");
    expect(await s.get("spotify", "nobody")).toBeNull();
  });

  it("lists connected accounts and revokes", async () => {
    const s = store();
    await s.set("x", "elon", { accessToken: "a" });
    await s.set("x", "dev", { apiKey: "k" });
    const accounts = await s.accounts("x");
    expect(accounts.map((a) => a.account).sort()).toEqual(["dev", "elon"]);
    // Manual API keys persist too (they used to be dropped on write).
    expect(accounts.find((a) => a.account === "dev")!.apiKey).toBe("k");
    expect((await s.get("x", "dev"))?.apiKey).toBe("k");

    await s.remove("x", "elon");
    expect(await s.get("x", "elon")).toBeNull();
  });

  it("keeps secrets out of the public listing", async () => {
    const s = store();
    await s.set("spotify", "dev", {
      accessToken: "a",
      secrets: { clientSecret: "hush" },
    });
    const accounts = await s.accounts("spotify");
    expect(accounts[0]!.accessToken).toBe("a");
    expect(JSON.stringify(accounts)).not.toContain("hush");
  });

  it("encrypts credentials at rest in Postgres (AES-256-GCM)", async () => {
    const conn = new FakeConnectionModel();
    const s = store({ connection: conn });
    await s.set("spotify", "taylorswift", {
      accessToken: "tok-123",
      refreshToken: "ref-456",
      secrets: { clientSecret: "hush" },
    });

    const raw = conn.peek("spotify::taylorswift")!;
    expect(raw.accessToken).toMatch(/^enc:v1:/);
    expect(raw.refreshToken).toMatch(/^enc:v1:/);
    expect(raw.accessToken).not.toContain("tok-123");
    expect(JSON.stringify(raw.secrets)).not.toContain("hush");

    const creds = await s.get("spotify", "taylorswift");
    expect(creds?.accessToken).toBe("tok-123");
    expect(creds?.refreshToken).toBe("ref-456");
    expect(creds?.secrets).toEqual({ clientSecret: "hush" });
  });

  it("reads legacy plaintext rows written before encryption", async () => {
    const conn = new FakeConnectionModel();
    await conn.upsert({
      where: { id: "x::elon" },
      create: {
        id: "x::elon",
        platform: "x",
        account: "elon",
        accessToken: "plain-tok",
        refreshToken: null,
        secrets: { k: "v" },
      },
      update: {
        accessToken: "plain-tok",
        refreshToken: null,
        secrets: { k: "v" },
      },
    });
    const creds = await store({ connection: conn }).get("x", "elon");
    expect(creds?.accessToken).toBe("plain-tok");
    expect(creds?.secrets).toEqual({ k: "v" });
  });
});

describe("Supabase-facilitated OAuth for social connections", () => {
  it("maps social platforms to Supabase OAuth providers and builds authorize URLs", () => {
    const svc = new SupabaseAuthService(
      {
        get: (k: string) =>
          k === "SUPABASE_URL" ? "https://aura.supabase.co" : undefined,
      } as never,
      store(),
    );
    expect(svc.providerFor("spotify")).toBe("spotify");
    expect(svc.providerFor("x")).toBe("twitter");
    expect(svc.providerFor("linkedin")).toBe("linkedin");
    expect(svc.providerFor("github")).toBe("github");
    expect(svc.providerFor("facebook")).toBe("facebook");
    expect(svc.providerFor("bbc")).toBeNull();
    expect(svc.providerFor("instagram")).toBeNull(); // not a Supabase provider

    const url = svc.authUrl(
      "spotify",
      "taylorswift",
      "https://oracle.auramarkets.world/v1/connections/oauth/spotify/callback",
      "https://app.auramarkets.world/me",
    )!;
    expect(url).toContain(
      "https://aura.supabase.co/auth/v1/authorize?provider=spotify",
    );
    const params = new URL(url).searchParams;
    // Supabase reserves `state` for its own flow state UUID and deletes any
    // client value, so we must NOT rely on it (the payload rides on redirect_to).
    expect(params.get("state")).toBeNull();
    // Supabase sends the browser to the ORACLE callback (server-side exchange),
    // with our account + app return URL on its own query string…
    const redirectTo = new URL(params.get("redirect_to")!);
    expect(`${redirectTo.origin}${redirectTo.pathname}`).toBe(
      "https://oracle.auramarkets.world/v1/connections/oauth/spotify/callback",
    );
    const state = redirectTo.searchParams.get(OAUTH_STATE_PARAM)!;
    expect(decodeOAuthState(state)).toMatchObject({
      account: "taylorswift",
      returnTo: "https://app.auramarkets.world/me",
    });
    // PKCE flow: without a challenge Supabase returns `#access_token=…` in the
    // fragment (invisible to the server); with it, it returns `?code=…`, and the
    // verifier is re-derived from the preserved payload at the callback.
    expect(params.get("code_challenge_method")).toBe("s256");
    const challenge = params.get("code_challenge")!;
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createHash("sha256").update(svc.verifierFor(state)).digest("base64url")).toBe(
      challenge,
    );
  });

  it("carries the flow payload on redirect_to's query so Supabase preserves it", () => {
    const svc = new SupabaseAuthService(
      {
        get: (k: string) =>
          k === "SUPABASE_URL" ? "https://aura.supabase.co" : undefined,
      } as never,
      store(),
    );
    const url = svc.authUrl("x", "0xabc", "https://oracle.auramarkets.world/v1/connections/oauth/x/callback")!;
    const redirectTo = new URL(new URL(url).searchParams.get("redirect_to")!);
    expect(redirectTo.searchParams.get(OAUTH_STATE_PARAM)).toBeTruthy();
    // No returnTo → the callback falls back to APP_URL, not a broken redirect.
    expect(decodeOAuthState(redirectTo.searchParams.get(OAUTH_STATE_PARAM))).toMatchObject({
      account: "0xabc",
    });
  });

  it("round-trips account/returnTo through state, tolerating legacy bare-account state", () => {
    const state = encodeOAuthState({ account: "dev", returnTo: "https://app.x/me" });
    expect(decodeOAuthState(state)).toEqual({ account: "dev", returnTo: "https://app.x/me" });
    expect(decodeOAuthState("dev")).toEqual({ account: "dev" }); // legacy
    expect(decodeOAuthState(undefined)).toEqual({ account: "" });
  });

  it("only honours an absolute http(s) return URL (no open redirect)", () => {
    const svc = new SupabaseAuthService({ get: () => undefined } as never, store());
    expect(svc.returnUrl("https://app.auramarkets.world/me")).toBe(
      "https://app.auramarkets.world/me",
    );
    expect(svc.returnUrl("javascript:alert(1)")).toBe("http://localhost:5173");
    expect(svc.returnUrl(undefined)).toBe("http://localhost:5173");
  });

  it("appends the connection flag (preserving existing query) and escapes the error relay", () => {
    expect(connectionResultUrl("https://app.x/me?tab=1", "spotify:connected")).toBe(
      "https://app.x/me?tab=1&connection=spotify%3Aconnected",
    );
    const page = oauthErrorPage("https://app.x/me", "spotify");
    expect(page).toContain('"https://app.x/me"');
    expect(page).toContain("connection=spotify%3Aerror");
    expect(page).toContain("window.location.hash");
  });

  it("returns null auth URLs when Supabase or the platform is unavailable", () => {
    const svc = new SupabaseAuthService(
      { get: () => undefined } as never,
      store(),
    );
    expect(svc.authUrl("spotify", "dev", "https://x")).toBeNull();
  });
});

describe("Shopify merchant OAuth", () => {
  it("builds the authorize URL with read_orders/read_customers scopes", () => {
    const svc = new ShopifyAuthService(
      {
        get: (k: string) => (k === "SHOPIFY_CLIENT_ID" ? "abc123" : undefined),
      } as never,
      store(),
    );
    const url = svc.authUrl(
      "my-store.myshopify.com",
      "https://app.auramarkets.world/oauth/shopify",
    )!;
    expect(url).toContain(
      "https://my-store.myshopify.com/admin/oauth/authorize",
    );
    expect(url).toContain("client_id=abc123");
    // URLSearchParams encodes the comma-separated scopes.
    expect(decodeURIComponent(url)).toContain(
      "scope=read_orders,read_customers,read_products,read_inventory,read_discounts",
    );
    expect(url).toContain("state=my-store");
  });

  it("returns null when the app is not configured", () => {
    const svc = new ShopifyAuthService(
      { get: () => undefined } as never,
      store(),
    );
    expect(svc.authUrl("my-store", "https://x")).toBeNull();
  });
});
