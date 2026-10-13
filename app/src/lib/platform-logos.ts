/**
 * Vendored, full-color platform marks — one local file per platform under
 * `public/platforms/`.
 *
 * These used to be hot-linked from Wikimedia Commons, which 404'd (X) and
 * rate-limited (429) the rest, so brand marks silently degraded to Jazzicons.
 * Local files fix that and work offline. `x`, `github` and `tiktok` are
 * brand-colored tiles (white glyph on the brand fill) so they read in both the
 * light and dark themes; the other marks are self-colored glyphs.
 *
 * The canonical keys are the adapter `platform` strings (see AGENTS.md); the
 * aliases below cover the extra names the UI uses (`twitter`, `hn`, `news`).
 */
export const PLATFORM_LOGOS: Record<string, string> = {
  x: "/platforms/x.svg",
  twitter: "/platforms/x.svg",
  youtube: "/platforms/youtube.svg",
  reddit: "/platforms/reddit.svg",
  instagram: "/platforms/instagram.svg",
  spotify: "/platforms/spotify.svg",
  github: "/platforms/github.svg",
  twitch: "/platforms/twitch.svg",
  facebook: "/platforms/facebook.svg",
  linkedin: "/platforms/linkedin.svg",
  shopify: "/platforms/shopify.svg",
  tiktok: "/platforms/tiktok.svg",
  discord: "/platforms/discord.svg",
  hackernews: "/platforms/hackernews.svg",
  hn: "/platforms/hackernews.svg",
  ycombinator: "/platforms/hackernews.svg",
  rss: "/platforms/rss.svg",
  news: "/platforms/rss.svg",
  bbc: "/platforms/rss.svg",
};

/** The local logo for a platform key, or null (unknown → identicon fallback). */
export function platformLogo(platform?: string | null): string | null {
  if (!platform) return null;
  return PLATFORM_LOGOS[platform.toLowerCase()] ?? null;
}
