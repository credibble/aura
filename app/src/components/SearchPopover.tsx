import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  Bitcoin,
  Gem,
  Search,
  Sparkles,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { handleSlug } from "@/lib/handle-id";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { Skeleton } from "@/components/ui/skeletons";
import { formatIndex, formatPct } from "@/lib/format";
import { CATEGORIES } from "@/lib/aura-data";
import { handleSearchOptions, handlesQueryOptions, peopleSearchOptions } from "@/queries/handles";

/** Live index/change per handle — one cached query, no refetch per keystroke. */
function useHandlesData() {
  const { data } = useQuery(handlesQueryOptions);
  return { handles: data };
}

/** Browse destinations — every one lands on the explore grid. */
const browse: {
  label: string;
  icon: typeof Search;
  to: "/";
}[] = [
  { label: "All markets", icon: TrendingUp, to: "/" },
  { label: "Leaderboard", icon: Trophy, to: "/" },
];

export function SearchPopover({
  className,
  iconOnly = false,
}: {
  className?: string;
  /** Compact icon trigger — used by the sticky explore header. */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const needle = q.trim();

  // Searching happens in the indexer (name/symbol ilike), not by scanning
  // the client's list; the store only provides each hit's live index + change.
  const searchQuery = useQuery(handleSearchOptions(needle));
  const { handles } = useHandlesData();

  const results = useMemo(() => {
    const query = needle.toLowerCase();
    if (!query) return [];
    const byId = new Map(
      (handles ?? []).map((h) => [
        h.id,
        {
          id: h.id,
          symbol: h.symbol ?? "?",
          name: h.name ?? h.id,
          color: "hsl(var(--primary))",
          index: Number(h.aura) / 100,
          change: Number(h.auraDelta) / 100,
        },
      ]),
    );
    return (searchQuery.data ?? [])
      .map((h) => byId.get(h.id))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .slice(0, 6);
  }, [handles, searchQuery.data]);

  // People search — indexer `name` ilike, first 6 active handles.
  const peopleQuery = useQuery({ ...peopleSearchOptions(needle), enabled: !!needle });
  const peopleResults = useMemo(() => peopleQuery.data ?? [], [peopleQuery.data]);

  const goAsset = (id: string) => {
    setOpen(false);
    navigate({ to: "/$id", params: { id: handleSlug(id) } });
  };

  const goHandle = (id: string) => {
    setOpen(false);
    navigate({ to: "/$id", params: { id: handleSlug(id) } });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Search markets"
          className={cn(
            iconOnly
              ? "grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border/70 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              : "flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-secondary/60 px-2.5 py-2 text-left transition-colors hover:border-primary/40 sm:px-3",
            className,
          )}
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          {!iconOnly && (
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {q || "Search markets…"}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[min(560px,calc(100vw-2rem))] rounded-xl border-border bg-card p-0 shadow-xl"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (results[0]) goAsset(results[0].id);
            else if (peopleResults[0]) goHandle(peopleResults[0].id);
          }}
          className="flex items-center gap-2 border-b border-border px-4 py-3"
        >
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            aria-label="Search markets, posts and people"
            placeholder="Search markets, posts, people…"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </form>

        {needle && (
          <div className="border-b border-border p-3">
            <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Markets
            </div>
            {results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No markets found</p>
            ) : (
              <div className="space-y-1">
                {results.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => goAsset(a.id)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-secondary/60"
                  >
                    <AssetAvatar asset={a} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{a.name}</span>
                      <span className="block text-xs text-muted-foreground">{a.symbol}</span>
                    </span>
                    <span className="num shrink-0 text-xs text-muted-foreground">
                      {formatIndex(a.index)}
                    </span>
                    <span
                      className={cn(
                        "num w-16 shrink-0 text-right text-xs font-semibold",
                        a.change >= 0 ? "text-up" : "text-down",
                      )}
                    >
                      {formatPct(a.change)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="mb-2 mt-4 text-xs font-semibold uppercase text-muted-foreground">
              People
            </div>
            {peopleResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {peopleQuery.isFetching ? "Searching people…" : "No people found"}
              </p>
            ) : (
              <div className="space-y-1">
                {peopleResults.map((h) => {
                  const name = h.name ?? h.symbol ?? h.id;
                  const aura = Number(h.aura) / 100;
                  const change = Number(h.auraDelta) / 100;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => goHandle(h.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-secondary/60"
                    >
                      <AssetAvatar
                        asset={{
                          id: h.id,
                          symbol: (h.symbol ?? h.id).toUpperCase().slice(0, 4),
                          color: "hsl(var(--primary))",
                          name,
                        }}
                        size={32}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1">
                          <span className="truncate font-medium text-foreground">{name}</span>
                          {h.verified && (
                            <BadgeCheck
                              className="h-4 w-4 shrink-0 text-link"
                              aria-label="Verified market"
                            />
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          @{(h.symbol ?? h.id).toLowerCase()}
                        </span>
                      </span>
                      <span className="num shrink-0 text-xs text-muted-foreground">
                        {formatIndex(aura)}
                      </span>
                      <span
                        className={cn(
                          "num w-16 shrink-0 text-right text-xs font-semibold",
                          change >= 0 ? "text-up" : "text-down",
                        )}
                      >
                        {formatPct(change)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Browse
          </div>
          <div className="flex flex-wrap gap-2">
            {browse.map((b) => {
              const Icon = b.icon;
              return (
                <Link
                  key={b.label}
                  to={b.to}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-secondary/70"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {b.label}
                </Link>
              );
            })}
          </div>

          <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Categories
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CATEGORIES.map((c) => {
              const Icon =
                c.id === "crypto"
                  ? Bitcoin
                  : c.id === "sports"
                    ? Trophy
                    : c.id === "people"
                      ? Users
                      : c.id === "brands"
                        ? Gem
                        : Sparkles;
              return (
                <Link
                  key={c.id}
                  to="/"
                  hash={c.id}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-secondary/60"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary/70">
                    <Icon className={cn("h-5 w-5", c.tint)} />
                  </span>
                  <span className="text-sm font-medium text-foreground">{c.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
