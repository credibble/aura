import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownUp, Check, ChevronDown, List as ListIcon, Map as MapIcon } from "lucide-react";
import { FeedLayout } from "@/components/social/FeedLayout";
import { FeedSearch } from "@/components/social/RightSidebar";
import { SearchPopover } from "@/components/SearchPopover";
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
 * The index is the market. Two ways to read it:
 *
 *   - **Map** (default) — the Aura Atlas: a flat, pannable world where every
 *     handle is a plot in its category's district. Position is stable (hashed
 *     from the id); aura rides on the marker's size and glow, so the world is a
 *     fixed stage the live index performs on. Category chips fly the camera;
 *     search flies to a handle.
 *   - **List** — the original grid, kept whole: server-side sort + paging and
 *     infinite scroll. It is the accessible / low-power fallback too.
 *
 * Both read the same live data; the map just places it on a plane.
 */
function ExplorePage() {
  const [cat, setCat] = useState<CategoryId | "all">("all");
  const [sort, setSort] = useState<Sort>("Highest aura");
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
  // Category chips filter the list locally — the query itself is unfiltered.
  const list = useMemo(
    () => (cat === "all" ? assets : assets.filter((a) => a.categories.includes(cat))),
    [assets, cat],
  );

  /** A chip selects AND (on the map) flies the camera to that district. */
  const pickCategory = useCallback(
    (id: CategoryId | "all") => {
      setCat(id);
      if (mode !== "map") return;
      if (id === "all") worldRef.current?.fitAll();
      else worldRef.current?.focusCategory(id);
    },
    [mode],
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

  // The sticky bar reveals a search icon only once the hero's own search has
  // fully left the viewport — a scroll distance cannot express that.
  const [stuck, setStuck] = useState(false);
  const heroSearchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = heroSearchRef.current;
    if (!el) {
      setStuck(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <FeedLayout contentWidth="wide">
      {/* Hero — one line, one action, one search */}
      <div className="px-4 pt-10 pb-6 text-center sm:px-6">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-4xl">
          Everything has an $AURA
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Spot it early. Trade it first — before the timeline does.
        </p>
        <div
          ref={heroSearchRef}
          className="mx-auto mt-5 flex w-full max-w-md items-center justify-center gap-2"
        >
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

      {/* Sticky filter bar — categories left; layout, search and sort pinned right. */}
      <div className="sticky top-[var(--app-topbar)] z-30 flex min-w-0 items-center gap-2 border-b border-border/70 bg-background/90 px-4 backdrop-blur-md sm:px-6">
        <ScrollRow
          activeKey={cat}
          ariaLabel="Categories"
          wrapperClassName="flex-1"
          className="-ml-4 gap-1 px-4 sm:-ml-6 sm:px-6"
        >
          <CategoryChip label="All" active={cat === "all"} onClick={() => pickCategory("all")} />
          {CATEGORIES.map((c) => (
            <CategoryChip
              key={c.id}
              label={c.label}
              active={cat === c.id}
              onClick={() => pickCategory(c.id)}
            />
          ))}
        </ScrollRow>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ModeToggle mode={mode} onChange={setMode} />

          {/* Appears once the hero is out of view; the wrapper keeps its space. */}
          <div
            className={cn(
              "shrink-0 transition-all duration-200",
              stuck ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0",
            )}
            aria-hidden={!stuck}
            inert={!stuck}
          >
            <SearchPopover iconOnly onPick={pickHandle} />
          </div>

          {mode === "list" && (
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
          )}
        </div>
      </div>

      {mode === "map" ? (
        <div ref={gate} className="px-4 pb-5 sm:px-6">
          <div className="h-[min(76vh,860px)] min-h-[440px]">
            {handlesPending ? (
              <div className="grid h-full place-items-center rounded-2xl border border-border/70 bg-card text-sm text-muted-foreground">
                Charting the atlas…
              </div>
            ) : (
              <WorldMap ref={worldRef} plots={plots} activeCategory={cat} />
            )}
          </div>
        </div>
      ) : (
        <>
          <div
            ref={gate}
            className="grid grid-cols-1 gap-3 px-4 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-3"
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
    </FeedLayout>
  );
}

/** Map ⇄ List. The map is the default; the grid is the accessible fallback. */
function ModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const options = [
    { id: "map" as const, label: "Map", Icon: MapIcon },
    { id: "list" as const, label: "List", Icon: ListIcon },
  ];
  return (
    <div
      role="tablist"
      aria-label="Explore layout"
      className="flex shrink-0 rounded-full border border-border/70 p-0.5"
    >
      {options.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={mode === id}
          onClick={() => onChange(id)}
          className={cn(
            "flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
            mode === id
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

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
