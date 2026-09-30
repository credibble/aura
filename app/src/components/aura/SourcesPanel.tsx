import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";

type SourceKind = "social" | "community" | "media" | "search";

/**
 * Real platform artwork for the source row — the same logos used on the
 * portfolio connectors. Unknown platforms fall back to their identicon.
 */
const SOURCE_LOGOS: Record<string, string> = {
  x: "https://upload.wikimedia.org/wikipedia/commons/6/6f/X_Logo_2023.svg",
  twitter: "https://upload.wikimedia.org/wikipedia/commons/6/6f/X_Logo_2023.svg",
  youtube:
    "https://upload.wikimedia.org/wikipedia/commons/0/09/YouTube_full-color_icon_%282017%29.svg",
  instagram: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Instagram_logo_2016.svg",
  facebook: "https://upload.wikimedia.org/wikipedia/commons/5/51/Facebook_f_logo_%282019%29.svg",
  linkedin: "https://upload.wikimedia.org/wikipedia/commons/c/ca/LinkedIn_logo_initials.png",
  twitch: "https://upload.wikimedia.org/wikipedia/commons/2/26/Twitch_logo.svg",
  spotify: "https://upload.wikimedia.org/wikipedia/commons/1/19/Spotify_logo_without_text.svg",
  github: "https://upload.wikimedia.org/wikipedia/commons/9/91/Octicons-mark-github.svg",
};

const KIND_RING: Record<SourceKind, string> = {
  social: "group-hover/row:border-sky-500/50",
  community: "group-hover/row:border-violet-500/50",
  media: "group-hover/row:border-amber-500/50",
  search: "group-hover/row:border-emerald-500/50",
};

const KIND_LABEL: Record<SourceKind, string> = {
  social: "Social",
  community: "Community",
  media: "Media",
  search: "Search",
};

const SOCIAL = new Set([
  "x",
  "twitter",
  "reddit",
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "linkedin",
  "twitch",
  "spotify",
]);
const COMMUNITY = new Set(["github", "discord", "forum"]);
const MEDIA = new Set(["news", "rss", "bbc"]);

function kindOf(platform: string): SourceKind {
  const p = platform.toLowerCase();
  if (SOCIAL.has(p)) return "social";
  if (COMMUNITY.has(p)) return "community";
  if (MEDIA.has(p)) return "media";
  return "search";
}

type ParsedSource = { platform: string; name: string };

/**
 * Parse one adapter source config (JSON string on the Handle entity) into a
 * platform + identifier for the row. Unparsable configs show their raw text —
 * real data either way, never synthesized.
 */
function parseSource(raw: string): ParsedSource {
  try {
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    const platform = typeof cfg.platform === "string" ? cfg.platform : "source";
    const ident =
      (typeof cfg.username === "string" && cfg.username) ||
      (typeof cfg.channel === "string" && cfg.channel) ||
      (typeof cfg.page === "string" && cfg.page) ||
      (typeof cfg.login === "string" && cfg.login) ||
      (typeof cfg.orgId === "string" && cfg.orgId) ||
      (typeof cfg.topic === "string" && cfg.topic) ||
      (typeof cfg.feed === "string" && cfg.feed) ||
      (typeof cfg.url === "string" && cfg.url) ||
      "";
    return { platform, name: ident ? `${platform} · ${ident}` : platform };
  } catch {
    return { platform: "source", name: raw };
  }
}

/**
 * Horizontal row of the handle's real source outlets (adapter configs stored
 * on the Handle entity). Each expands on hover to reveal its identifier.
 */
export function SourcesPanel({ sources, label }: { sources: string[]; label?: string }) {
  const rows = sources.map(parseSource);

  return (
    <section aria-label="Sources">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-foreground">Sources</h3>
        <span className="text-[11px] text-muted-foreground">
          {rows.length} outlet{rows.length === 1 ? "" : "s"} feeding the {label ?? "aura index"}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {rows.map((s, i) => {
          const kind = kindOf(s.platform);
          return (
            <span
              key={`${s.name}-${i}`}
              title={`${s.name} · ${KIND_LABEL[kind]}`}
              className={cn(
                "group/row flex cursor-default items-center gap-0 rounded-full border border-border bg-secondary/50 py-1 pl-1 pr-1 transition-all duration-200 hover:bg-secondary group-hover/row:gap-2 group-hover/row:pr-3",
                KIND_RING[kind],
              )}
            >
              <Avatar
                seed={s.platform}
                image={SOURCE_LOGOS[s.platform.toLowerCase()] ?? null}
                size={28}
                alt={s.name}
                className="shrink-0"
              />
              <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-medium text-foreground opacity-0 transition-all duration-200 ease-out group-hover/row:max-w-[220px] group-hover/row:opacity-100">
                {s.name}
              </span>
            </span>
          );
        })}
        {rows.length === 0 && (
          <span className="text-[13px] text-muted-foreground">
            No sources connected to this handle yet.
          </span>
        )}
      </div>
    </section>
  );
}
