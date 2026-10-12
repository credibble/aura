import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownUp, Check, ChevronDown, List as ListIcon, Map as MapIcon } from "lucide-react";
import { FeedLayout } from "@/components/social/FeedLayout";
import { FeedSearch } from "@/components/social/RightSidebar";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { SparkCard } from "@/components/aura/SparkCard";
import { SparkCardSkeleton } from "@/components/ui/skeletons";
import { HowItWorks } from "@/components/HowItWorks";
import { ScrollRow } from "@/components/ScrollRow";
import { WorldMap, type WorldMapHandle } from "@/components/aura/WorldMap";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CATEGORIES, type CategoryId } from "@/lib/aura-data";
import { layoutWorld } from "@/lib/world-layout";
import { HANDLE_CARD_FIELDS, toLiveAsset, useHandles, type IndexerHandle } from "@/queries/handles";
import { indexerInfiniteOptions, flatIndexerPages } from "@/lib/indexer-page";
import { useIndexerLive } from "@/lib/indexer-ws";
import { qk } from "@/queries/keys";
import { usePollGate } from "@/lib/poll-registry";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aura — Everything has an $AURA" },
      {
        name: "description",
        content:
          "Spot it early. Trade it first. Aura markets on the names the internet can't stop talking about.",
      },
    ],
  }),
  component: ExplorePage,
});

const SORTS = ["Highest aura", "Movers", "Windows", "Name"] as const;
type Sort = (typeof SORTS)[number];

/** Sort key → the indexer's own ordering field (sorting is done server-side). */
const ORDER_BY: Record<Sort, { field: string; dir: "asc" | "desc" }> = {
  "Highest aura": { field: "aura", dir: "desc" },
  Movers: { field: "auraDelta", dir: "desc" },
  Windows: { field: "windowCount", dir: "desc" },
  Name: { field: "name", dir: "asc" },
};

type ViewMode = "map" | "list";

/**
 * The index is the market — and by default the market is the Atlas: a
 * full-screen, pannable village where every handle is a villager in its
 * category's district. The world is mounted `fixed inset-0` UNDER the page
 * chrome; the hero and the floating dock read as overlays on top of it.
 *
 * A floating action at the bottom right switches to the accessible list: the
 * original grid with server-side sort + paging and infinite scroll.
 */
function ExplorePage() {
  const [cat, setCat] = useState<CategoryId | "all">("all");
  const [sort, setSort] = useState<Sort>("Highest aura");
  // 2D is the default AND the init: mode is never restored from the URL (or
  // anywhere else), so every load SSRs + hydrates straight into the map —
  // there is no other mode to flash on reload.
  const [mode, setMode] = useState<ViewMode>("map");
  const order = ORDER_BY[sort];
  const worldRef = useRef<WorldMapHandle | null>(null);

  // List: the paginated, server-sorted grid. Only fetched when the list is shown.
  const query = useInfiniteQuery({
    ...indexerInfiniteOptions<IndexerHandle>({
      queryKey: ["explore", sort],
      entity: "Handle",
      fields: HANDLE_CARD_FIELDS,
      where: "where: { active: { _eq: true } }",
      orderBy: order.field,
      orderDirection: order.dir,
      limit: 24,
    }),
    enabled: mode === "list",
  });
  const isPending = query.isPending;

  // Map: the whole atlas. `useHandles` is the shared handle list (also the
  // search popover's source), so the map costs no extra query.
  const { data: handles, isPending: handlesPending } = useHandles();
  const mapAssets = useMemo(() => (handles ?? []).map(toLiveAsset), [handles]);
  const plots = useMemo(() => layoutWorld(mapAssets), [mapAssets]);

  // Aura pushes only stream while their surface is on screen.
  const gate = usePollGate<HTMLDivElement>(qk.handles);

  // List subscription — the grid's own sort order.
  useIndexerLive<{ Handle: IndexerHandle[] }>({
    queryKey: ["explore", sort],
    query: `subscription { Handle(where: { active: { _eq: true } }, order_by: { ${order.field}: ${order.dir} }) { ${HANDLE_CARD_FIELDS} } }`,
    enabled: mode === "list",
  });
  // Map subscription — keeps the shared handle list (and so the world) fresh.
  useIndexerLive<{ Handle: { id: string }[] }>({
    queryKey: qk.handles,
    query: `subscription { Handle(where: { active: { _eq: true } }) { id aura auraDelta } }`,
    enabled: mode === "map",
  });

  const assets = useMemo(() => flatIndexerPages(query.data?.pages).map(toLiveAsset), [query.data]);
  // Tabs filter on the FULL `categories` array — a handle carries every family
  // it belongs to, so it shows under each matching tab (the map, by contrast,
  // stands it in its primary district only).
  const list = useMemo(
    () => (cat === "all" ? assets : assets.filter((a) => a.categories.includes(cat))),
    [assets, cat],
  );

  /** Search results fly to a plot instead of navigating while the map is up. */
  const pickHandle = useCallback(
    (id: string) => {
      if (mode !== "map") return false;
      return worldRef.current?.focusHandle(id) ?? false;
    },
    [mode],
  );

  // `/#crypto` (from the search popover's category links) flies to that district.
  useEffect(() => {
    if (mode !== "map") return;
    const applyHash = () => {
      const id = window.location.hash.replace(/^#/, "");
      if (!id || !CATEGORIES.some((c) => c.id === id)) return;
      setCat(id as CategoryId);
      worldRef.current?.focusCategory(id as CategoryId);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [mode]);

  return (
    <FeedLayout contentWidth="wide" dockNav={mode === "map"}>
      {mode === "map" && (
        /* The Atlas — fixed, full-screen, UNDER the page chrome. Gestures land
           only where no overlay covers it. */
        <div ref={gate} className="fixed inset-0 z-0">
          {handlesPending ? (
            <div className="grid h-full place-items-center bg-background text-sm text-muted-foreground">
              Charting the atlas…
            </div>
          ) : (
            <WorldMap ref={worldRef} plots={plots} activeCategory={cat} />
          )}
        </div>
      )}

      {/* Hero overlay — one line, one action, one search. Bare: no background
          or border, it floats straight on the Atlas (whose ground IS the page
          background). Clicks fall through everywhere except the controls —
          a character standing behind the headline is still clickable. */}
      <div className="pointer-events-none relative z-10 px-4 pb-6 pt-10 text-center sm:px-6">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-4xl">
          Everything has an $AURA
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Spot it early. Trade it first — before the timeline does.
        </p>
        <div className="mx-auto mt-5 flex w-full max-w-md items-center justify-center gap-2 pointer-events-auto">
          <FeedSearch onPick={pickHandle} />
          <HowItWorks>
            <button
              type="button"
              className="shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110"
            >
              How it works
            </button>
          </HowItWorks>
        </div>
      </div>

      {mode === "list" && (
        <>
          {/* Category tabs (left) + sort (right) — the list's own filter bar.
              Selection here filters the grid; going back to the map clears it,
              so the Atlas always opens with every district lit. */}
          <div className="sticky top-[var(--app-topbar)] z-30 flex min-w-0 items-center gap-2 border-b border-border/70 bg-background/90 px-4 backdrop-blur-md sm:px-6">
            <ScrollRow
              activeKey={cat}
              ariaLabel="Categories"
              wrapperClassName="flex-1"
              className="-ml-4 gap-1 px-4 sm:-ml-6 sm:px-6"
            >
              <CategoryChip label="All" active={cat === "all"} onClick={() => setCat("all")} />
              {CATEGORIES.map((c) => (
                <CategoryChip
                  key={c.id}
                  label={c.label}
                  active={cat === c.id}
                  onClick={() => setCat(c.id)}
                />
              ))}
            </ScrollRow>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Sort markets"
                    className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-border/70 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <ArrowDownUp className="h-3.5 w-3.5" />
                    {sort}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {SORTS.map((s) => (
                    <DropdownMenuItem key={s} onSelect={() => setSort(s)} className="gap-2">
                      <span className="flex-1">{s}</span>
                      {sort === s && <Check className="h-3.5 w-3.5 text-primary" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div
            ref={gate}
            className="relative z-10 grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-2 sm:px-6 lg:grid-cols-3"
          >
            {isPending
              ? Array.from({ length: 8 }, (_, i) => <SparkCardSkeleton key={i} />)
              : list.map((a) => <SparkCard key={a.id} asset={a} />)}
            {!isPending && list.length === 0 && (
              <div className="col-span-full rounded-2xl border border-border/70 bg-card px-4 py-16 text-center">
                <p className="text-[15px] font-semibold">Nothing&apos;s farming yet</p>
                <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
                  Handles pop up the second they start publishing aura on-chain.
                </p>
              </div>
            )}
          </div>

          {query.hasNextPage && (
            <InfiniteSentinel
              ready={!query.isFetchingNextPage}
              onEnd={() => void query.fetchNextPage()}
            />
          )}
        </>
      )}

      {/* Map ⇄ list — floating action, bottom right. Map is the default. */}
      <button
        type="button"
        onClick={() => {
          if (mode === "list") setCat("all");
          setMode(mode === "map" ? "list" : "map");
        }}
        aria-label={mode === "map" ? "Switch to list mode" : "Switch to map mode"}
        className="fixed bottom-4 right-4 z-20 flex h-11 items-center gap-2 rounded-full border border-border/70 bg-background/90 px-4 text-sm font-medium text-foreground shadow-lg backdrop-blur-md transition-colors hover:bg-secondary"
      >
        {mode === "map" ? (
          <>
            <ListIcon className="h-4 w-4" />
            List mode
          </>
        ) : (
          <>
            <MapIcon className="h-4 w-4" />
            Map mode
          </>
        )}
      </button>
    </FeedLayout>
  );
}

/** Category tab — underline style, list mode's filter bar. */
function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? "true" : undefined}
      className={cn(
        "shrink-0 border-b-2 px-3 py-3 text-sm transition-colors",
        active
          ? "border-foreground font-semibold text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
