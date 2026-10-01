import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownUp, Check, ChevronDown } from "lucide-react";
import { FeedLayout } from "@/components/social/FeedLayout";
import { FeedSearch } from "@/components/social/RightSidebar";
import { SearchPopover } from "@/components/SearchPopover";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { SparkCard } from "@/components/aura/SparkCard";
import { SparkCardSkeleton } from "@/components/ui/skeletons";
import { HowItWorks } from "@/components/HowItWorks";
import { ScrollRow } from "@/components/ScrollRow";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CATEGORIES, type CategoryId } from "@/lib/aura-data";
import { HANDLE_CARD_FIELDS, toLiveAsset, type IndexerHandle } from "@/queries/handles";
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

/**
 * The index is the market grid. Sorting and paging happen in the indexer query
 * (`order_by` / `limit` / `offset`); category chips filter CLIENT-side by family
 * (`categoriesOf(handle)`), so one cached list per sort serves every chip.
 */
function ExplorePage() {
  const [cat, setCat] = useState<CategoryId | "all">("all");
  const [sort, setSort] = useState<Sort>("Highest aura");
  const order = ORDER_BY[sort];
  const query = useInfiniteQuery(
    indexerInfiniteOptions<IndexerHandle>({
      queryKey: ["explore", sort],
      entity: "Handle",
      fields: HANDLE_CARD_FIELDS,
      where: "where: { active: { _eq: true } }",
      orderBy: order.field,
      orderDirection: order.dir,
      limit: 24,
    }),
  );
  const isPending = query.isPending;
  // The sticky bar reveals a search icon once the hero has scrolled away —
  // while the hero's own search is on screen the icon would be a duplicate
  // affordance, and on a 320px bar it competes with the sort control.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 120);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // Aura pushes only stream while the grid is on screen.
  const gate = usePollGate<HTMLDivElement>(qk.handles);

  // The grid is the indexer's surface — its subscription is the event source.
  useIndexerLive<{ Handle: IndexerHandle[] }>({
    queryKey: ["explore", sort],
    query: `subscription { Handle(where: { active: { _eq: true } }, order_by: { ${order.field}: ${order.dir} }) { ${HANDLE_CARD_FIELDS} } }`,
  });

  const assets = useMemo(() => flatIndexerPages(query.data?.pages).map(toLiveAsset), [query.data]);
  // Category chips filter by family locally — the query itself is unfiltered.
  const list = useMemo(
    () => (cat === "all" ? assets : assets.filter((a) => a.categories.includes(cat))),
    [assets, cat],
  );

  return (
    // No `sidebar` on purpose: the explore grid is the page. `contentWidth="wide"`
    // spends the aside's 350px on the grid (centre cap 840 → 1190), so the block
    // is exactly as wide as a sidebar page instead of 350px narrower. Every other
    // route keeps its sidebar and the default 840px centre; the rail is unchanged.
    <FeedLayout contentWidth="wide">
      {/* Hero — one line, one action, one search */}
      <div className="px-4 pt-10 pb-6 text-center sm:px-6">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-4xl">
          Everything has an $AURA
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Spot it early. Trade it first.</p>
        <div className="mx-auto mt-5 flex w-full max-w-md items-center justify-center gap-2">
          <FeedSearch />
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

      {/* Sticky filter bar — categories left, search + sort pinned right.
          `top` clears the sticky mobile Navbar (--app-topbar = its height below
          lg, 0 at lg where the desktop rail replaces it). */}
      <div className="sticky top-[var(--app-topbar)] z-30 flex items-center gap-2 border-b border-border/70 bg-background/90 pr-4 backdrop-blur-md sm:pr-6">
        <ScrollRow
          activeKey={cat}
          ariaLabel="Categories"
          className="min-w-0 flex-1 gap-1 px-4 sm:px-6"
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

        {/* Appears once the hero is out of view. The wrapper keeps its space
            (no layout shift) and `inert` takes the hidden button out of the tab
            order so keyboard users can't focus an invisible control. */}
        <div
          className={cn(
            "shrink-0 transition-all duration-200",
            stuck ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0",
          )}
          aria-hidden={!stuck}
          inert={!stuck}
        >
          <SearchPopover iconOnly />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Sort markets"
              className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
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

      {/* 4 cols from xl: the wide centre gives 3 cols ~372px cards — ~46% wider
          than any other page's grid. Four keeps the reading density (~276px,
          near the 840px grid's 255px) and the chart's aspect close to before;
          xl (1280) is the first width where 1190px actually fits beside the rail. */}
      <div
        ref={gate}
        className="grid grid-cols-1 gap-3 px-4 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-3"
      >
        {isPending
          ? Array.from({ length: 8 }, (_, i) => <SparkCardSkeleton key={i} />)
          : list.map((a) => <SparkCard key={a.id} asset={a} />)}
        {!isPending && list.length === 0 && (
          <div className="col-span-full rounded-2xl border border-border/70 bg-card px-4 py-16 text-center">
            <p className="text-[15px] font-semibold">No markets here yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
              Handles appear as soon as they start publishing aura on-chain.
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
    </FeedLayout>
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
