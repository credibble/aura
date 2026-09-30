import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TrendingUp, TrendingDown, Crown, Medal } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { Skeleton, SkeletonAvatar, TableSkeleton } from "@/components/ui/skeletons";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { usePollGate } from "@/lib/poll-registry";
import { HANDLE_FIELDS, categoryFromCode, type SubgraphHandle } from "@/queries/handles";
import { subgraphInfiniteOptions, flatSubgraphPages } from "@/lib/subgraph-page";
import { handleSlug } from "@/lib/handle-id";
import { qk } from "@/queries/keys";
import { CATEGORY_MAP } from "@/lib/aura-data";
import { cn } from "@/lib/utils";

const sorts = ["Aura", "Change", "Windows"] as const;
type Sort = (typeof sorts)[number];

function rankColor(rank: number) {
  if (rank === 1) return "text-[hsl(43_90%_50%)]";
  if (rank === 2) return "text-muted-foreground";
  if (rank === 3) return "text-[hsl(25_70%_50%)]";
  return "text-muted-foreground/70";
}

/** Latest aura push delta (subgraph `Handle.auraDelta`, 1e2 → absolute points). */
function changePts(h: SubgraphHandle): number {
  return Number(h.auraDelta) / 100;
}

function metricOf(h: SubgraphHandle, sort: Sort): number {
  if (sort === "Aura") return Number(h.aura) / 100;
  if (sort === "Change") return changePts(h);
  return Number(h.windowCount);
}

function metricLabel(h: SubgraphHandle, sort: Sort): string {
  if (sort === "Aura") return metricOf(h, sort).toFixed(2);
  if (sort === "Change") {
    const v = metricOf(h, sort);
    return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
  }
  return String(metricOf(h, sort));
}

export const Route = createFileRoute("/leaderboard")({
  head: () => ({
    meta: [{ title: "Leaderboard — Aura" }],
  }),
  component: LeaderboardPage,
});

/** Sort key → the subgraph's own ordering field. */
const ORDER_BY: Record<Sort, string> = {
  Aura: "aura",
  Change: "auraDelta",
  Windows: "windowCount",
};

function LeaderboardPage() {
  const [sort, setSort] = useState<Sort>("Aura");
  // Sorting + paging happen in the subgraph query itself.
  const ranks = useInfiniteQuery(
    subgraphInfiniteOptions<SubgraphHandle>({
      queryKey: ["leaderboard", sort],
      entity: "handles",
      fields: HANDLE_FIELDS,
      where: "where: { active: true }",
      orderBy: ORDER_BY[sort],
      orderDirection: "desc",
      limit: 25,
    }),
  );
  const isLoading = ranks.isPending;
  const gate = usePollGate<HTMLDivElement>(qk.handles);

  const list = flatSubgraphPages(ranks.data?.pages);
  const podium = list.slice(0, 3);

  return (
    <PageShell
      header={
        <div
          ref={gate}
          className="static z-30 flex flex-wrap items-end justify-between gap-4 border-b border-border/70 bg-background/85 px-4 py-5 backdrop-blur-md sm:px-6 lg:sticky lg:top-0"
        >
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Leaderboard</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Handles ranked by live aura across every market window.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:block">
              {isLoading ? "Loading…" : `${list.length} ranked live`}
            </span>
            <Segmented options={sorts} value={sort} onChange={setSort} />
          </div>
        </div>
      }
    >
      {/* Top three — a quiet podium, no cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {isLoading
          ? Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl px-3 py-3">
                <SkeletonAvatar size={44} />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="mt-1.5 h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-12" />
              </div>
            ))
          : podium.map((h, i) => <PodiumItem key={h.id} handle={h} rank={i + 1} sort={sort} />)}
      </div>

      {isLoading ? (
        <TableSkeleton rows={7} />
      ) : (
        <>
          {/* Table — free-standing rows (scrolls sideways on narrow screens) */}
          <div className="mt-8 overflow-x-auto">
            <div className="min-w-[620px]">
        <div className="grid grid-cols-[40px_1fr_auto] items-center gap-3 border-b border-border/70 pb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[40px_1fr_100px_100px_120px]">
          <span>#</span>
          <span>Handle</span>
          <span className="hidden text-right sm:block">Change</span>
          <span className="hidden text-right sm:block">Windows</span>
          <span className="text-right">{sort}</span>
        </div>
        {list.slice(3).map((h, i) => {
          const rank = i + 4;
          const change = changePts(h);
          return (
            <Link
              key={h.id}
              to="/$id"
              params={{ id: handleSlug(h) }}
              className="grid grid-cols-[40px_1fr_auto] items-center gap-3 border-b border-border/50 py-3 transition-colors last:border-0 hover:bg-secondary/25 sm:grid-cols-[40px_1fr_100px_100px_120px]"
            >
              <span className={cn("num text-[13px] font-semibold", rankColor(rank))}>
                {rank <= 3 ? <Medal className="h-3.5 w-3.5" /> : null}
                {rank}
              </span>
              <span className="flex min-w-0 items-center gap-3">
                <AssetAvatar
                  asset={{
                    id: h.id,
                    symbol: (h.symbol ?? h.id).toUpperCase().slice(0, 4),
                    color: "hsl(var(--primary))",
                    name: h.name ?? h.symbol ?? h.id,
                  }}
                  size={34}
                />
                <span className="min-w-0 leading-tight">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{h.name ?? h.id}</span>
                    <span className="hidden truncate text-xs text-muted-foreground md:inline">
                      @{handleSlug(h)}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {CATEGORY_MAP[categoryFromCode(h.category)]?.label ?? "Market"}
                    {h.graduated ? " · Graduated" : ""}
                  </span>
                </span>
              </span>
              <span
                className={cn(
                  "num hidden text-right text-[13px] sm:block",
                  change >= 0 ? "text-up" : "text-down",
                )}
              >
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)}
              </span>
              <span className="num hidden text-right text-[13px] text-muted-foreground sm:block">
                {h.windowCount}
              </span>
              <span
                className={cn(
                  "num text-right text-sm font-semibold",
                  sort === "Change" ? (change >= 0 ? "text-up" : "text-down") : "text-foreground",
                )}
              >
                {metricLabel(h, sort)}
              </span>
            </Link>
          );
        })}
            </div>
          </div>
        </>
      )}

      {ranks.hasNextPage && (
        <InfiniteSentinel
          ready={!ranks.isFetchingNextPage}
          onEnd={() => void ranks.fetchNextPage()}
        />
      )}
    </PageShell>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-full border border-border/70 p-1">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            value === o
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function PodiumItem({ handle, rank, sort }: { handle: SubgraphHandle; rank: number; sort: Sort }) {
  const change = changePts(handle);
  const name = handle.name ?? handle.symbol ?? handle.id;

  return (
    <Link
      to="/$id"
      params={{ id: handleSlug(handle) }}
      className="flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-secondary/30"
    >
      <AssetAvatar
        asset={{
          id: handle.id,
          symbol: (handle.symbol ?? handle.id).toUpperCase().slice(0, 4),
          color: "hsl(var(--primary))",
          name,
        }}
        size={44}
      />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1.5">
          {rank === 1 && <Crown className="h-3.5 w-3.5 shrink-0 text-[hsl(43_90%_50%)]" />}
          <span className="truncate text-sm font-semibold">{name}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {change >= 0 ? (
            <TrendingUp className="h-3 w-3 text-up" />
          ) : (
            <TrendingDown className="h-3 w-3 text-down" />
          )}
          <span className={cn("num", change >= 0 ? "text-up" : "text-down")}>
            {change >= 0 ? "+" : ""}
            {change.toFixed(2)}
          </span>
          <span>· {handle.windowCount} windows</span>
        </div>
      </div>
      <span
        className={cn(
          "num shrink-0 text-lg font-bold",
          sort === "Change" ? (change >= 0 ? "text-up" : "text-down") : "text-foreground",
        )}
      >
        {metricLabel(handle, sort)}
      </span>
    </Link>
  );
}
