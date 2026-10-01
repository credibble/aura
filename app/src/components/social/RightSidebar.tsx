import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BadgeCheck, MoreHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { SearchPopover } from "@/components/SearchPopover";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { useSocial } from "@/lib/social-store";
import { CATEGORY_MAP } from "@/lib/aura-data";
import { formatUsd, formatCompact, hasCount } from "@/lib/format";
import { UsdcIcon } from "@/components/aura/UsdcIcon";
import { handleSlug, labelOf, findHandle } from "@/lib/handle-id";
import { cn } from "@/lib/utils";
import { handlesQueryOptions, useHandleArtwork, type IndexerHandle } from "@/queries/handles";
import { postsOptions } from "@/queries/posts";
import { flatPages } from "@/queries/page";
import { statsQueryOptions, useStatsLive } from "@/queries/markets";

// ----------------------------------------------------------------------------
// The right sidebar: search pill, Earn (liquidity) card, Today's News,
// What's happening, Who to follow, footer links. Used by feed and post pages.
// ----------------------------------------------------------------------------

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)}>
      {children}
    </section>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  // One title scale for the rail. The weight carries it — `tracking-tight` on an
  // extrabold heading was a third signal for the same emphasis.
  return <h2 className="px-4 pt-3 pb-2 text-lg font-bold text-foreground">{children}</h2>;
}

export function FeedSearch() {
  return (
    <SearchPopover className="h-10 w-full rounded-full border-transparent bg-secondary/60 px-4 text-muted-foreground hover:border-primary/40 hover:text-foreground" />
  );
}

export function EarnCard() {
  // TVL = USDC locked in unsettled windows (indexer Stats.totalCash, 1e18);
  // volume/windows are the protocol's real counters — nothing is estimated.
  const { data: stats } = useQuery(statsQueryOptions);
  // The Stats row is patched in place from the indexer subscription.
  useStatsLive();
  const tvl = Number(stats?.totalCash ?? 0) / 1e18;
  const volume = Number(stats?.totalVolume ?? 0) / 1e18;
  return (
    <Card>
      <CardTitle>Earn</CardTitle>
      <div className="px-4 pb-4">
        <p className="text-sm leading-snug text-muted-foreground">
          Provide liquidity in USDC and earn steady yield from every window traded on Aura.
        </p>
        <div className="mt-4 flex items-center gap-4 rounded-xl bg-secondary/60 px-3 py-2">
          <div>
            <p className="num flex items-center gap-1 text-lg font-bold leading-none text-foreground">
              <UsdcIcon size={14} />
              {formatUsd(tvl)}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
              USDC pooled
            </p>
          </div>
          <span className="h-8 w-px bg-border" />
          <div>
            <p className="num flex items-center gap-1 text-lg font-bold leading-none text-foreground">
              <UsdcIcon size={14} />
              {formatUsd(volume)}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
              Total volume
            </p>
          </div>
        </div>
        <Link
          to="/"
          className="mt-4 block w-full rounded-full bg-primary px-4 py-2.5 text-center text-sm font-bold text-primary-foreground transition-all hover:brightness-110"
        >
          Explore markets
        </Link>
      </div>
    </Card>
  );
}

export function TodayNewsCard() {
  const [hidden, setHidden] = useState(false);
  const { data } = useInfiniteQuery(postsOptions(undefined, 5));
  const news = flatPages(data?.pages).slice(0, 4);
  if (hidden || news.length === 0) return null;
  return (
    <Card>
      <div className="flex items-start justify-between">
        <CardTitle>Today's News</CardTitle>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setHidden(true)}
          className="mr-2 mt-2 grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div>
        {news.map((n) => (
          <Link
            key={n.id}
            to="/post/$id"
            params={{ id: n.id }}
            className="block px-4 py-3 transition-colors hover:bg-secondary/40"
          >
            <p className="text-sm font-bold leading-snug text-foreground hover:underline">
              {n.summary}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {n.ts} · {CATEGORY_MAP[n.category]?.label ?? n.category}
              {hasCount(n.stats?.reposts) || hasCount(n.stats?.likes)
                ? ` · ${formatCompact((n.stats?.reposts ?? 0) + (n.stats?.likes ?? 0))} reactions`
                : ""}
            </p>
          </Link>
        ))}
      </div>
    </Card>
  );
}

export function HappeningCard() {
  const [hidden, setHidden] = useState(false);
  const { data } = useInfiniteQuery(postsOptions(undefined, 6));
  const happening = flatPages(data?.pages).slice(0, 4);
  if (hidden || happening.length === 0) return null;
  return (
    <Card>
      <div className="flex items-start justify-between">
        <CardTitle>What's happening</CardTitle>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setHidden(true)}
          className="mr-2 mt-2 grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div>
        {happening.map((h) => (
          <div
            key={h.id}
            className="group flex items-start justify-between gap-2 px-4 py-3 transition-colors hover:bg-secondary/40"
          >
            <Link to="/post/$id" params={{ id: h.id }} className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {h.handle} · {h.ts}
              </p>
              <p className="truncate text-sm font-bold leading-snug text-foreground group-hover:underline">
                {h.summary}
              </p>
            </Link>
            <button
              type="button"
              aria-label="More"
              onClick={() =>
                toast.info(h.summary, { description: `Open ${h.handle} to trade it.` })
              }
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** The handle's follow-row view — top of the indexer's aura-ranked list. */
function SuggestedRow({ h }: { h: IndexerHandle }) {
  const { isFollowing, toggleFollow } = useSocial();
  const artwork = useHandleArtwork();
  const slug = handleSlug(h);
  const handle = `@${slug}`;
  const name = h.name ?? h.symbol ?? h.id;
  const following = isFollowing(handle);
  const href = { to: "/$id" as const, params: { id: slug } };
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/40">
      <Link {...href} className="shrink-0">
        <AssetAvatar
          asset={{
            id: h.id,
            symbol: (h.symbol ?? h.id).toUpperCase().slice(0, 4),
            color: "hsl(var(--primary))",
            name,
            // The real seeded/edited photo — a handle avatar must never fall back
            // to an identicon when the metadata has one.
            ...artwork(h.id),
          }}
          size={40}
        />
      </Link>
      <div className="min-w-0 flex-1 leading-tight">
        <Link {...href} className="block min-w-0">
          <span className="flex items-center gap-1">
            <span className="truncate text-sm font-bold text-foreground hover:underline">
              {name}
            </span>
            {h.verified && (
              <BadgeCheck className="h-4 w-4 shrink-0 text-link" aria-label="Verified market" />
            )}
          </span>
          <span className="block truncate text-sm text-muted-foreground">{handle}</span>
        </Link>
      </div>
      <button
        type="button"
        onClick={() => toggleFollow(handle)}
        className={cn(
          "min-h-11 shrink-0 rounded-full px-4 text-sm font-bold transition-colors",
          following
            ? "border border-border text-foreground hover:border-down/60 hover:text-down"
            : "bg-foreground text-background hover:bg-foreground/85",
        )}
      >
        {following ? "Following" : "Follow"}
      </button>
    </div>
  );
}

export function WhoToFollowCard() {
  // Real suggestions: the top handles by aura, straight from the indexer.
  const { data: handles } = useQuery(handlesQueryOptions);
  const suggested = (handles ?? []).slice(0, 4);
  if (suggested.length === 0) return null;
  return (
    <Card>
      <CardTitle>Who to follow</CardTitle>
      <div>
        {suggested.map((h) => (
          <SuggestedRow key={h.id} h={h} />
        ))}
      </div>
      <Link
        to="/"
        className="block w-full px-4 py-3 text-left text-sm text-link transition-colors hover:bg-secondary/40"
      >
        Show more
      </Link>
    </Card>
  );
}

/** Detail-page rail: the handle's market + a short relevant-people row. */
export function RelevantPeopleCard({ marketId }: { marketId: string }) {
  const { isFollowing, toggleFollow } = useSocial();
  const artwork = useHandleArtwork();
  // Resolve the post's market to a real handle — tolerant of id / slug / name,
  // and falling back to the top handle when nothing matches.
  const { data: handles } = useQuery(handlesQueryOptions);
  const h = findHandle(handles, marketId) ?? handles?.[0];
  const slug = h ? handleSlug(h) : labelOf(marketId);
  const handle = `@${slug}`;
  const name = h ? (h.name ?? h.symbol ?? h.id) : labelOf(marketId);
  const following = isFollowing(handle);
  const href = { to: "/$id" as const, params: { id: slug } };

  return (
    <Card>
      <CardTitle>Relevant people</CardTitle>
      <div className="flex items-center gap-3 px-4 pb-4">
        <Link {...href} className="shrink-0">
          <AssetAvatar
            asset={{
              id: h?.id ?? marketId,
              symbol: (h?.symbol ?? slug).toUpperCase().slice(0, 4),
              color: "hsl(var(--primary))",
              name,
              ...artwork(h?.id ?? marketId),
            }}
            size={40}
          />
        </Link>
        <div className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-1">
            <Link
              {...href}
              className="truncate text-sm font-bold text-foreground hover:underline"
            >
              {name}
            </Link>
            {h?.verified && (
              <BadgeCheck className="h-4 w-4 shrink-0 text-link" aria-label="Verified market" />
            )}
          </span>
          <span className="block truncate text-sm text-muted-foreground">{handle}</span>
          <span className="block truncate text-xs text-muted-foreground/80">
            Aura market · {h ? `${Number(h.aura) / 100} aura` : "aura market"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => toggleFollow(handle)}
          className={cn(
            "min-h-11 shrink-0 rounded-full px-4 text-sm font-bold transition-colors",
            following
              ? "border border-border text-foreground hover:border-down/60 hover:text-down"
              : "bg-foreground text-background hover:bg-foreground/85",
          )}
        >
          {following ? "Following" : "Follow"}
        </button>
      </div>
    </Card>
  );
}

export function SidebarFooter() {
  // Only destinations that actually exist — no dead labels.
  const links: { label: string; to: string }[] = [
    { label: "Terms", to: "/terms" },
    { label: "Privacy", to: "/privacy" },
  ];
  return (
    <nav className="flex flex-wrap gap-x-3 gap-y-1 px-1 pb-6 text-xs text-muted-foreground/70">
      {links.map((l) => (
        <Link key={l.label} to={l.to} className="hover:underline">
          {l.label}
        </Link>
      ))}
      <span>© 2026 Aura</span>
    </nav>
  );
}

/** Standard home-feed sidebar stack. */
export function HomeSidebar() {
  return (
    <>
      <FeedSearch />
      <EarnCard />
      <WhoToFollowCard />
      <SidebarFooter />
    </>
  );
}

/** Trade-page sidebar stack (relevant people first). */
export function PostSidebar({ marketId }: { marketId: string }) {
  return (
    <>
      <FeedSearch />
      <RelevantPeopleCard marketId={marketId} />
      <SidebarFooter />
    </>
  );
}
