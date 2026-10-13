import type { ConfigService } from "@nestjs/config";

/**
 * The chat-completions endpoint + auth the Kimi-backed AI callers use. Moonshot
 * and 0G both speak the OpenAI `/chat/completions` shape, so switching hosts is
 * a URL + key + model change — nothing at the call sites.
 */
export interface KimiEndpoint {
  apiKey?: string;
  model: string;
  baseUrl: string;
  /** True when routed through 0G's OpenAI-compatible router. */
  viaZeroG: boolean;
  /** The env var the key is expected in — for accurate fail-closed warnings. */
  keyName: string;
}

const MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1";
const MOONSHOT_MODEL = "kimi-k2.6";
const ZERO_G_BASE_URL = "https://router-api.0g.ai/v1";
const ZERO_G_MODEL = "kimi-k2.5";

/** Truthy flag: accepts a coerced boolean or "true"/"1"/"yes"/"on". */
function isOn(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

/**
 * Resolve which Kimi-compatible endpoint the AI callers hit.
 *
 * `KIMI_VIA_0G=true` routes chat completions through 0G's OpenAI-compatible
 * router (`https://router-api.0g.ai/v1`, model `kimi-k2.5`, key
 * `ZERO_G_API_KEY`); otherwise they go to Moonshot directly
 * (`KIMI_BASE_URL` / `KIMI_MODEL` / `KIMI_API_KEY`). One env var flips the whole
 * AI layer without touching a single call site.
 */
export function resolveKimiEndpoint(config: ConfigService): KimiEndpoint {
  if (isOn(config.get("KIMI_VIA_0G"))) {
    return {
      apiKey: config.get<string>("ZERO_G_API_KEY") ?? undefined,
      model: config.get<string>("ZERO_G_MODEL") ?? ZERO_G_MODEL,
      baseUrl: (config.get<string>("ZERO_G_BASE_URL") ?? ZERO_G_BASE_URL).replace(/\/$/, ""),
      viaZeroG: true,
      keyName: "ZERO_G_API_KEY",
    };
  }
  return {
    apiKey: config.get<string>("KIMI_API_KEY") ?? undefined,
    model: config.get<string>("KIMI_MODEL") ?? MOONSHOT_MODEL,
    baseUrl: (config.get<string>("KIMI_BASE_URL") ?? MOONSHOT_BASE_URL).replace(/\/$/, ""),
    viaZeroG: false,
    keyName: "KIMI_API_KEY",
  };
}
