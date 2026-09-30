import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownUp, Check, ChevronDown } from "lucide-react";
import { FeedLayout } from "@/components/social/FeedLayout";
import { FeedSearch, SidebarFooter } from "@/components/social/RightSidebar";
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
import { HANDLE_CARD_FIELDS, toLiveAsset, type SubgraphHandle } from "@/queries/handles";
import { subgraphInfiniteOptions, flatSubgraphPages } from "@/lib/subgraph-page";
import { qk } from "@/queries/keys";
import { usePollGate } from "@/lib/poll-registry";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aura — Trade the aura index" },
      {
        name: "description",
        content:
          "Spot it early. Trade the aura index on the names the internet can't stop talking about.",
      },
    ],
  }),
  component: ExplorePage,
});

const SORTS = ["Highest aura", "Movers", "Windows", "Name"] as const;
type Sort = (typeof SORTS)[number];

/** Sort key → the subgraph's own ordering field (sorting is done server-side). */
const ORDER_BY: Record<Sort, { field: string; dir: "asc" | "desc" }> = {
  "Highest aura": { field: "aura", dir: "desc" },
  Movers: { field: "auraDelta", dir: "desc" },
  Windows: { field: "windowCount", dir: "desc" },
  Name: { field: "name", dir: "asc" },
};

/**
 * The index is the market grid. Sorting and paging happen in the subgraph query
 * (`orderBy` / `first` / `skip`); category chips filter the loaded pages in
 * place because a handle's category is a CODE whose family prefix GraphQL can't
 * match with a plain `where` equality.
 */
function ExplorePage() {
  const [cat, setCat] = useState<CategoryId | "all">("all");
  const [sort, setSort] = useState<Sort>("Highest aura");
  const [stuck, setStuck] = useState(false);
  const order = ORDER_BY[sort];
  // Category filtering happens AT THE API (`where.categoryId`, a family id the
  // subgraph derives from the numeric code). Until that field is deployed the
  // query errors — then we fall back to the unfiltered list + a local filter.
  const catQuery = useInfiniteQuery(
    subgraphInfiniteOptions<SubgraphHandle>({
      queryKey: ["explore", sort, cat],
      entity: "handles",
      fields: HANDLE_CARD_FIELDS,
      where: cat === "all" ? "where: { active: true }" : `where: { active: true, categoryId: "${cat}" }`,
      orderBy: order.field,
      orderDirection: order.dir,
      limit: 24,
    }),
  );
  const fallbackQuery = useInfiniteQuery({
    ...subgraphInfiniteOptions<SubgraphHandle>({
      queryKey: ["explore", sort, "all"],
      entity: "handles",
      fields: HANDLE_CARD_FIELDS,
      where: "where: { active: true }",
      orderBy: order.field,
      orderDirection: order.dir,
      limit: 24,
    }),
    enabled: catQuery.isError,
    retry: false,
  });
  const query = catQuery.isError ? fallbackQuery : catQuery;
  const isPending = query.isPending;
  // Aura pushes only stream while the grid is on screen.
  const gate = usePollGate<HTMLDivElement>(qk.handles);

  // The sticky bar reveals a search icon once the hero has scrolled away.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 120);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const assets = useMemo(() => flatSubgraphPages(query.data?.pages).map(toLiveAsset), [query.data]);
  // The API already filtered when `categoryId` is deployed; the local filter is
  // a no-op then and the fallback path when it isn't.
  const list = useMemo(
    () => (cat === "all" ? assets : assets.filter((a) => a.category === cat)),
    [assets, cat],
  );

  return (
    <FeedLayout fluid sidebar={<ExploreSidebar />}>
      {/* Hero — one line, one action, one search */}
      <div className="px-4 pt-10 pb-6 text-center sm:px-6">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-4xl">Trade the aura index</h1>
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

      {/* Sticky filter bar — categories left, search + sort pinned right */}
      <div className="sticky top-[92px] z-30 flex items-center gap-2 border-b border-border/70 bg-background/90 pr-4 backdrop-blur-md sm:pr-6 lg:top-0">
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

        {/* Appears once the hero is out of view */}
        <div
          className={cn(
            "shrink-0 transition-all duration-200",
            stuck ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0",
          )}
          aria-hidden={!stuck}
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

function ExploreSidebar() {
  return (
    <>
      <section className="rounded-2xl border border-border/70 bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">How it settles</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          Every market is one handle and one window. Trade Up or Down on its aura index before the
          window closes — the winning side pays 100¢.
        </p>
      </section>
      <SidebarFooter />
    </>
  );
}
