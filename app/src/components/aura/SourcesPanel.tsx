import { Avatar } from "@/components/Avatar";
import { platformLogo } from "@/lib/platform-logos";
import { cn } from "@/lib/utils";

type SourceKind = "social" | "community" | "media" | "search";

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

type ParsedSource = { id: string; platform: string; name: string };

/**
 * Parse one adapter source config (JSON string on the Handle entity) into a
 * platform + identifier for the row. Unparsable configs show their raw text —
 * real data either way, never synthesized.
 *
 * `id` is the config's `outlet` when present (the same id the adapters use), so
 * rows can be deduped against legacy on-chain duplicates; a config without one
 * falls back to its raw text, which is unique by construction.
 */
function parseSource(raw: string): ParsedSource {
  try {
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    const platform = typeof cfg.platform === "string" ? cfg.platform : "source";
    const outlet = typeof cfg.outlet === "string" ? cfg.outlet : "";
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
    return { id: outlet || raw, platform, name: ident ? `${platform} · ${ident}` : platform };
  } catch {
    return { id: raw, platform: "source", name: raw };
  }
}

/**
 * Horizontal row of the handle's real source outlets (adapter configs stored
 * on the Handle entity). Each expands on hover to reveal its identifier.
 */
export function SourcesPanel({ sources, label }: { sources: string[]; label?: string }) {
  // Dedupe by the adapter `outlet` id: older seed runs could append a second
  // config for the same outlet, and those legacy on-chain rows must render once.
  const rows = [...new Map(sources.map(parseSource).map((s) => [s.id, s])).values()];

  return (
    <section aria-label="Sources">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-foreground">Sources</h3>
        <span className="text-[11px] text-muted-foreground">
          {rows.length} outlet{rows.length === 1 ? "" : "s"} feeding the {label ?? "aura index"}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {rows.map((s) => {
          const kind = kindOf(s.platform);
          return (
            <span
              key={s.id}
              title={`${s.name} · ${KIND_LABEL[kind]}`}
              className={cn(
                "group/row flex cursor-default items-center gap-0 rounded-full border border-border bg-secondary/50 py-1 pl-1 pr-1 transition-all duration-200 hover:bg-secondary group-hover/row:gap-2 group-hover/row:pr-3",
                KIND_RING[kind],
              )}
            >
              <Avatar
                seed={s.platform}
                image={platformLogo(s.platform)}
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
