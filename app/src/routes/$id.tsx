import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  Clock,
  History,
  Info,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { FeedLayout } from "@/components/social/FeedLayout";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { FeedItem } from "@/components/feeds/FeedItem";
import { QueryError } from "@/components/QueryState";
import { trendColorFrom } from "@/lib/chart-domain";
import {
  ChartSkeleton,
  HandleHeaderSkeleton,
  MarketPanelSkeleton,
} from "@/components/ui/skeletons";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { CHART_PLOT_RATIO, MultiChart } from "@/components/aura/MultiChart";
import { OrderBook } from "@/components/aura/OrderBook";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TradeTicket } from "@/components/aura/TradeTicket";
import { StakePopup } from "@/components/portfolio/StakePopup";
import { StakeButton } from "@/components/aura/StakeButton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toMarket } from "@/lib/aura-markets";
import { selectWindow } from "@/lib/window-state";
import { CATEGORY_MAP, indexLabel, type CategoryId } from "@/lib/aura-data";
import { findHandle, handleSlug, labelOf } from "@/lib/handle-id";
import { formatCents, formatCompact, formatIndex, formatPct, formatUsd } from "@/lib/format";
import { UsdcAmount } from "@/components/aura/UsdcIcon";
import { useSocial } from "@/lib/social-store";
import { useAuraContracts } from "@/lib/contracts";
import { usePollGate } from "@/lib/poll-registry";
import {
  auraHistoryOptions,
  handleWindowsOptions,
  useHandleWindowsLive,
  useWindowPointsLive,
  useWindowTradesLive,
  windowPricePointsOptions,
  windowTradesOptions,
} from "@/queries/markets";
import { handlesQueryOptions, type IndexerHandle } from "@/queries/handles";
import { postsOptions } from "@/queries/posts";
import { flatPages } from "@/queries/page";
import { stakeOptions, useStakeLive } from "@/queries/stake";
import { qk } from "@/queries/keys";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/$id")({
  head: () => ({ meta: [{ title: "Trade — Aura" }] }),
  component: TradePage,
});

const RANGES = [
  { id: "1H", spanMs: 3_600_000 },
  { id: "6H", spanMs: 6 * 3_600_000 },
  { id: "1D", spanMs: 24 * 3_600_000 },
  { id: "ALL", spanMs: Number.POSITIVE_INFINITY },
] as const;

/** Upper bound on the aura memo markers drawn for one chart: the aura lens can
 *  hold a full day of ticks, and a marker <button> per tick would flood the DOM.
 *  Matches the 64-row budget the shallow handle list used to cap memos at. */
const MAX_MEMOS = 64;

const ICON_BTN =
  "grid h-10 w-10 place-items-center rounded-full border border-border/70 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";

type TabId = "feeds" | "trades" | "orderbook";

/** One-line label for a window: "17 Jul, 3:44 PM–4:14 PM". */
function windowLabel(w: { windowStart: string; windowEnd: string }): string {
  const start = new Date(Number(w.windowStart) * 1000);
  const end = new Date(Number(w.windowEnd) * 1000);
  const day = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const t = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${t(start)}–${t(end)}`;
}

function ago(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function shortUser(id: string): string {
  return /^0x[0-9a-f]{40}$/i.test(id) ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/**
 * One trade page for every handle — `/:slug`, where the slug is a name (never
 * bytes32, never `@`). Identity + live index in a header that tightens as you
 * scroll, price history as the hero, and feeds / tape / rules in tabs. Follow,
 * stake and share are icon actions named by tooltip.
 */
function TradePage() {
  const { id: param } = Route.useParams();
  const { address, api } = useAuraContracts();
  const { data: handles, isPending: handlesPending, isError: handlesError, refetch: refetchHandles } =
    useQuery(handlesQueryOptions);
  const h = useMemo(() => findHandle(handles, param), [handles, param]);
  const handleId = h?.id ?? param;

  const windowsQuery = useQuery(handleWindowsOptions(handleId));
  const windows = useMemo(() => windowsQuery.data ?? [], [windowsQuery.data]);
  const viewable = useMemo(
    () => windows.filter((w) => w.outcomes.length > 0 && Number(w.windowEnd) > 0),
    [windows],
  );
  const live = selectWindow(viewable).live;

  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("1D");
  /**
   * What the single chart plots: the outcome PRICES (the odds) or the handle's
   * AURA — the value the market's question is about, which is where the strike
   * line belongs. One chart, two lenses.
   */
  const [chartMode, setChartMode] = useState<"aura" | "prices">("aura");
  const [tab, setTab] = useState<TabId>("feeds");
  const [picked, setPicked] = useState(0);
  const [compact, setCompact] = useState(false);
  // null = follow the live window; an id = a previous window the user opened.
  const [windowId, setWindowId] = useState<string | null>(null);
  const viewed =
    (windowId ? viewable.find((w) => w.id === windowId) : null) ?? live ?? viewable[0] ?? null;
  const isLiveView = !!viewed && !!live && viewed.id === live.id;
  const market = useMemo(() => (viewed ? toMarket(viewed) : null), [viewed]);

  // Header tightens once the hero scrolls away.
  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 48);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Feeds tab = the oracle's published digests for this handle.
  const feeds = useInfiniteQuery({ ...postsOptions(handleId), enabled: !!handleId });
  const feedsPosts = flatPages(feeds.data?.pages);

  const gate = usePollGate<HTMLDivElement>(qk.handleWindows(handleId));
  const pointsQuery = useQuery(windowPricePointsOptions(viewed?.id));
  const tradesQuery = useInfiniteQuery(windowTradesOptions(viewed?.id));
  // The aura lens' own source — up to 24h of `AuraHistory` (bounded by a
  // lookback AND a limit), not the shallow 64-row list embedded in `handles`.
  // Normalised to oldest-first so both the line and the memo markers share one
  // ordering.
  const auraHistoryQuery = useQuery(auraHistoryOptions(handleId));
  const auraHistory = useMemo(
    () =>
      [...(auraHistoryQuery.data ?? [])].sort(
        (a, b) => Number(a.timestamp) - Number(b.timestamp),
      ),
    [auraHistoryQuery.data],
  );

  // The market detail is indexer-streamed: the handle's windows, the chart's
  // price points and the trade tape each keep their query fresh over the socket.
  useHandleWindowsLive(handleId);
  useWindowPointsLive(viewed?.id);
  useWindowTradesLive(viewed?.id);

  // AURA staked on this handle. The CHAIN leads for the numbers (exact + fresh,
  // per the repo's data-source rules); the indexer is the fallback while an RPC
  // read is in flight. Mixing the two was the bug: the viewer's receipts came
  // from the vault (1e18) while the share price came from the indexer, so a
  // "Worth" figure could disagree with the receipts it was derived from.
  const vault = h?.stake && h.stake !== "0x" ? (h.stake as `0x${string}`) : undefined;
  useStakeLive(vault);
  const stakeEntity = useQuery(stakeOptions(vault));
  const stakeStatsQuery = useQuery({
    queryKey: qk.stake("stats", vault ?? ""),
    queryFn: () => api.readStakeStats(vault!),
    enabled: !!vault,
  });
  const stakeSharesQuery = useQuery({
    queryKey: qk.stake("shares", vault ?? "", address ?? ""),
    queryFn: () => api.readStakeShares(vault!, address ?? undefined),
    enabled: !!vault && !!address,
  });
  const stakeEarnedQuery = useQuery({
    queryKey: qk.stake("earned", vault ?? "", address ?? ""),
    queryFn: () => api.readStakeEarned(vault!, address ?? undefined),
    enabled: !!vault && !!address,
  });
  // The market's trading fee (bps) is a contract constant — read once. Shown in
  // the chart's footer stat row.
  const feeQuery = useQuery({
    queryKey: ["market-fee"],
    queryFn: () => api.readMarketFeeBps().catch(() => 0n),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const stakeStats = stakeStatsQuery.data
    ? {
        totalAssets: Number(stakeStatsQuery.data.totalAssets) / 1e18,
        valuePerToken: Number(stakeStatsQuery.data.valuePerToken) / 1e18,
      }
    : stakeEntity.data
      ? {
          totalAssets: Number(stakeEntity.data.totalAssets) / 1e18,
          valuePerToken: Number(stakeEntity.data.valuePerToken) / 1e18,
        }
      : undefined;
  const myStake =
    stakeSharesQuery.data !== undefined && stakeEarnedQuery.data !== undefined
      ? {
          shares: Number(stakeSharesQuery.data) / 1e18,
          earned: Number(stakeEarnedQuery.data) / 1e18,
        }
      : undefined;

  // Real per-trade price vectors, filtered to the selected range. The visible
  // span is returned too, so the aura memos can be placed on the same x axis.
  const chart = useMemo(() => {
    if (!market || !viewed) return null;
    const pts = pointsQuery.data ?? [];
    const startMs = Number(viewed.windowStart) * 1000;
    const endMs = Number(viewed.windowEnd) * 1000;
    // The window's first print is the seeded on-chain vector emitted at open
    // (`WindowOpened` probabilities, mirrored by the first `PricesUpdated` /
    // PricePoint). Its block timestamp can land a few seconds BEFORE
    // `windowStart`, so it would otherwise be dropped by the range filter below
    // — and the seed was only added when the first point was AFTER start, so
    // such a window drew nothing. Seed at `windowStart` unless a point already
    // sits exactly there, and fall back to the window's live `prices` vector if
    // the seeded one is missing. Both are real on-chain values.
    const seedPrices = viewed.initialProbabilities?.length
      ? viewed.initialProbabilities
      : viewed.prices;
    const seed = seedPrices?.length
      ? { ts: Number(viewed.windowStart), prices: seedPrices }
      : null;
    const arr =
      seed && (pts.length === 0 || Number(pts[0]!.ts) * 1000 !== startMs)
        ? [seed, ...pts]
        : pts;
    const cfg = RANGES.find((r) => r.id === range)!;
    const from = Number.isFinite(cfg.spanMs) ? Math.max(startMs, endMs - cfg.spanMs) : startMs;
    const to = Number.isFinite(cfg.spanMs) ? endMs : Math.max(endMs, startMs + 1);
    const filtered = arr.filter((p) => Number(p.ts) * 1000 >= from);
    const seriesTs = filtered.map((p) => Number(p.ts) * 1000);
    const series = market.outcomes.map((o, i) => {
      const data = filtered.map((p) => Number(p.prices?.[i] ?? 0) / 1e16);
      return {
        label: o.label,
        color: o.color,
        // A lone point can't form a path on its own; duplicate it so the
        // window draws its true level immediately as a flat line (the x axis is
        // point-indexed, so this spans the plot exactly like the other series).
        data: data.length === 1 ? [data[0]!, data[0]!] : data,
        // Real timestamps so the chart places points by time, not index. A
        // single point spans the whole range (flat line) rather than collapsing.
        ts: seriesTs.length === 1 ? [from, to] : seriesTs,
      };
    });
    return { series, from, to };
  }, [market, viewed, pointsQuery.data, range]);

  /**
   * The AURA lens' own time base. The price series only exists inside the
   * selected window, but the index is continuous: the query already pulled up
   * to 24h of `AuraHistory`, and the range chips pick a span WITHIN that day
   * (1H / 6H / 1D / ALL). The view is anchored at the newest point, not at
   * wall-clock now, so the line ends at the data instead of trailing into empty
   * time.
   */
  const auraChart = useMemo(() => {
    const all = auraHistory.map((p) => ({
      ts: Number(p.timestamp) * 1000,
      v: Number(p.aura) / 100,
    }));
    if (all.length === 0) return null;
    const dataStart = all[0]!.ts;
    const dataEnd = all[all.length - 1]!.ts;
    const cfg = RANGES.find((r) => r.id === range)!;
    const to = dataEnd;
    const from = Number.isFinite(cfg.spanMs) ? Math.max(dataStart, to - cfg.spanMs) : dataStart;
    const visible = all.filter((p) => p.ts >= from);
    if (visible.length === 0) return null;
    const values = visible.map((p) => p.v);
    const data = values.length === 1 ? [values[0]!, values[0]!] : values;
    // Real timestamps so samples hours apart aren't drawn equidistant — the
    // time-anchored memo markers then sit on the curve. A lone point spans the
    // range so its flat line still reads.
    const ts = visible.map((p) => p.ts);
    const dataTs = ts.length === 1 ? [from, to] : ts;
    // Green while the index rises over the last 24h — the same rule every other
    // chart uses. Anchored to the day, not to the range chip, so switching from
    // 1D to 1H never flips the line's colour.
    return { series: [{ label: "Aura", color: trendColorFrom(all), data, ts: dataTs }], from, to };
  }, [auraHistory, range]);

  // The strike is an AURA level: only draw it when the Aura series is what's
  // plotted. (If aura history is empty we fall back to the price series, which
  // is in whole percent — the strike belongs to a different space there and
  // would sit at the wrong height.)
  const auraShown = chartMode === "aura" && !!auraChart;

  // Aura snapshots mapped onto the chart's x axis — hover shows the memo. They
  // follow whichever lens is on screen, because the two lenses now have
  // different x-ranges. Capped with a stride so a day of ticks can't flood the
  // DOM with marker buttons.
  const memos = useMemo(() => {
    const view = auraShown ? auraChart : chart;
    if (!view) return [];
    const span = view.to - view.from || 1;
    const inView = auraHistory
      .map((p) => ({
        ts: Number(p.timestamp) * 1000,
        summary: p.summary ?? "Aura index updated from the handle's live sources.",
        aura: Number(p.aura) / 100,
      }))
      .filter((m) => m.ts >= view.from && m.ts <= view.to);
    const step = Math.max(1, Math.ceil(inView.length / MAX_MEMOS));
    return inView
      .filter((_, i) => i % step === 0 || i === inView.length - 1)
      .map((m) => ({ ...m, frac: (m.ts - view.from) / span }));
  }, [auraShown, auraChart, chart, auraHistory]);

  const [hover, setHover] = useState<number | null>(null);

  if (handlesPending || windowsQuery.isPending) {
    return (
      // The loaded page carries the trade ticket in the right rail; keep that
      // rail on the loading screen too, so the shell doesn't jump when the data
      // lands (the sidebar skeleton rhymes with the ticket + market panel).
      <FeedLayout sidebar={<MarketPanelSkeleton />}>
        <HandleHeaderSkeleton />
        <div className="space-y-4 px-4 pt-4 sm:px-6">
          <ChartSkeleton />
        </div>
      </FeedLayout>
    );
  }

  // A failed load is NOT "market not found" — without this branch an indexer
  // outage told the user the handle doesn't exist.
  if (handlesError || windowsQuery.isError) {
    return (
      <FeedLayout>
        <div className="px-4 pt-6 sm:px-6">
          <QueryError
            what="this market"
            onRetry={() => {
              void refetchHandles();
              void windowsQuery.refetch();
            }}
          />
        </div>
      </FeedLayout>
    );
  }

  if (!h) {
    return (
      <FeedLayout>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
          <h1 className="text-2xl font-bold">Couldn&apos;t find that one</h1>
          <p className="text-sm text-muted-foreground">
            No handle answers to “{labelOf(param)}”. It may have been renamed or never existed.
          </p>
          <Link
            to="/"
            className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
          >
            Browse markets
          </Link>
        </div>
      </FeedLayout>
    );
  }

  const index = Number(h.aura) / 100;
  const change = Number(h.auraDelta) / 100;
  const up = change >= 0;
  const symbol = (h.symbol ?? labelOf(h.id)).toUpperCase().slice(0, 4);
  const name = h.name ?? labelOf(h.id);
  const slug = handleSlug(h);
  const cat = market ? CATEGORY_MAP[market.category as CategoryId] : undefined;
  const trades = (tradesQuery.data?.pages ?? []).flatMap((p) => p.items);
  const tradable = h.graduated;

  // Footer stats: when this window closes, and the market's trading fee.
  const closeAt = viewed ? Number(viewed.windowEnd) * 1000 : NaN;
  const closeLabel = Number.isFinite(closeAt)
    ? new Date(closeAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
  const feeBps = feeQuery.data !== undefined ? Number(feeQuery.data) : null;
  const feeLabel = feeBps !== null ? `${(feeBps / 100).toFixed(2)}%` : "—";

  const copyLink = () => {
    navigator.clipboard?.writeText(`${window.location.origin}/${slug}`).catch(() => {});
    toast.success("Copied — go send it");
  };

  return (
    <FeedLayout
      sidebar={
        !tradable ? (
          <div className="rounded-2xl border border-border/70 bg-card p-4 text-sm leading-relaxed">
            <h2 className="text-sm font-semibold">Not tradable yet</h2>
            <p className="mt-2 text-muted-foreground">
              <span className="text-foreground">@{slug}</span> hasn&apos;t graduated, so its
              prediction market is locked. A handle graduates at{" "}
              <span className="num text-foreground">100</span> aura and unlocks trading.
            </p>
          </div>
        ) : market ? (
          <>
            <TradeTicket market={market} />
            <div className="rounded-2xl border border-border/70 bg-card p-4">
              <h2 className="text-sm font-semibold">Market</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <Row label="Volume">
                  <UsdcAmount value={formatUsd(market.volume)} size={12} />
                </Row>
                <Row label="Window">{market.deadline}</Row>
                <Row label="Index">{indexLabel(market.metric)}</Row>
                <Row label="Liquidity">
                  <UsdcAmount value={formatUsd(Number(viewed!.liquidity) / 1e18)} size={12} />
                </Row>
              </dl>

              {/* Staking — the handle's own vault, right under its market */}
              {vault && (
                <div className="mt-4 border-t border-border/70 pt-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Staked on @{slug}
                    </span>
                    <span className="num text-sm font-bold">
                      {stakeStats
                        ? `${formatCompact(stakeStats.totalAssets)}`
                        : "—"}
                      <span className="ml-1 text-xs font-medium text-muted-foreground">
                        AURA
                      </span>
                    </span>
                  </div>
                  {myStake && (
                    <div className="num mt-1.5 text-xs text-muted-foreground">
                      yours {formatCompact(myStake.earned)}{" "}
                      AURA
                    </div>
                  )}
                  <div className="mt-3">
                    <StakePopup
                      handle={stakeFrom(h, name, symbol, index)}
                      trigger={<StakeButton block />}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Rules live with the market facts, not in the trade column */}
            <div className="text-sm leading-relaxed text-muted-foreground">
              <h2 className="text-sm font-semibold text-foreground">Rules</h2>
              <p className="mt-2">
                This market resolves on the handle&apos;s aura index at the end of its{" "}
                {market.deadline} window. Exactly one outcome pays 100¢. Aura is not ownership.
              </p>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">
            No open window for <span className="text-foreground">@{slug}</span> right now. The next
            interval opens automatically.
          </div>
        )
      }
    >
      <TooltipProvider delayDuration={200}>
        <div ref={gate}>
          {/* Header — avatar shrinks as the page scrolls */}
          <div
            className={cn(
              "static z-30 border-b border-border/70 bg-background/85 backdrop-blur-md transition-all lg:sticky lg:top-0",
              compact ? "py-2" : "py-4",
            )}
          >
            <div className="flex items-center gap-3 px-4 sm:px-6">
              <Link
                to="/"
                aria-label="Back to markets"
                className="-ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <ChevronLeft className="h-5 w-5" />
              </Link>

              <AssetAvatar
                asset={{ id: h.id, symbol, color: "hsl(var(--primary))", name }}
                size={compact ? 36 : 56}
                className="shrink-0 transition-all duration-200"
              />

              <div className="min-w-0 flex-1 leading-tight">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "truncate font-bold transition-all",
                      compact ? "text-base" : "text-xl sm:text-2xl",
                    )}
                  >
                    {name}
                  </span>
                  {h.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-link" />}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate">@{slug}</span>
                  <span>·</span>
                  <span className="truncate">{cat?.label ?? "Market"}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="About the aura index"
                        className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Aggregated from this handle&apos;s live sources; every window settles on it.
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <div className="shrink-0 text-right leading-tight">
                <div className={cn("num font-bold", compact ? "text-lg" : "text-2xl sm:text-3xl")}>
                  {formatIndex(index)}
                </div>
                <div className={cn("num text-xs font-semibold", up ? "text-up" : "text-down")}>
                  {formatPct(change)}
                </div>
              </div>
            </div>
          </div>

          <div className="px-4 pt-4 sm:px-6">
            {market ? (
              <section className="rounded-2xl border border-border/70 bg-card p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    {/* What the chart plots. One chart: Aura shows the index the
                        market is about (with its strike line); Prices shows the
                        outcome odds. */}
                    {(["Aura", "Prices"] as const).map((m) => {
                      const on = (m === "Aura") === (chartMode === "aura");
                      return (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setChartMode(m === "Aura" ? "aura" : "prices")}
                          className={cn(
                            "min-h-10 rounded-lg px-2.5 text-xs font-semibold transition-colors",
                            on
                              ? "bg-secondary text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {m}
                        </button>
                      );
                    })}
                    <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
                    {RANGES.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setRange(r.id)}
                        className={cn(
                          "min-h-10 rounded-lg px-2.5 text-xs font-semibold transition-colors",
                          range === r.id
                            ? "bg-secondary text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {r.id}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Previous windows — pick another interval, or jump back to live */}
                    {!isLiveView && (
                      <button
                        type="button"
                        onClick={() => setWindowId(null)}
                        className="flex items-center gap-1.5 rounded-full bg-up/15 px-3 py-1.5 text-xs font-semibold text-up transition-colors hover:bg-up/25"
                      >
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" />
                        Back to live
                      </button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <History className="h-3.5 w-3.5" />
                          {isLiveView
                            ? "Live window"
                            : viewed
                              ? `${windowLabel(viewed)} · settled`
                              : "Window"}
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                        {live && (
                          <DropdownMenuItem onSelect={() => setWindowId(null)} className="gap-2">
                            <span className="flex-1">Live window</span>
                            {isLiveView && <Check className="h-3.5 w-3.5 text-primary" />}
                          </DropdownMenuItem>
                        )}
                        {[...viewable]
                          .filter((w) => w.settled)
                          .map((w) => (
                            <DropdownMenuItem
                              key={w.id}
                              onSelect={() => setWindowId(w.id)}
                              className="gap-2"
                            >
                              <span className="flex-1 truncate">{windowLabel(w)}</span>
                              {w.id === viewed?.id && (
                                <Check className="h-3.5 w-3.5 text-primary" />
                              )}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={copyLink}
                          aria-label="Copy link"
                          className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <Link2 className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Copy link</TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {/* Footer stats beside the range chips: volume, close time, fee.
                    No tinted strip — the card already sets these apart. */}
                <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-border/70 py-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium uppercase tracking-wide">Volume</span>
                    <UsdcAmount value={formatUsd(market.volume)} size={12} />
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium uppercase tracking-wide">Closes</span>
                    <span className="num text-foreground/90">{closeLabel}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium uppercase tracking-wide">Fee</span>
                    <span className="num text-foreground/90">{feeLabel}</span>
                  </span>
                </div>

                <div
                  className="relative h-[240px] sm:h-[280px]"
                  onMouseMove={(e) => {
                    if (memos.length === 0) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    const frac = Math.min(
                      1,
                      Math.max(0, (e.clientX - r.left) / (r.width * CHART_PLOT_RATIO)),
                    );
                    let best = 0;
                    for (let i = 1; i < memos.length; i++) {
                      if (Math.abs(memos[i]!.frac - frac) < Math.abs(memos[best]!.frac - frac))
                        best = i;
                    }
                    setHover(Math.abs(memos[best]!.frac - frac) < 0.06 ? best : null);
                  }}
                  onMouseLeave={() => setHover(null)}
                >
                  <MultiChart
                    series={auraShown ? auraChart!.series : (chart?.series ?? [])}
                    height={280}
                    strike={auraShown ? market.strike : undefined}
                    axis={auraShown ? "points" : "percent"}
                    from={auraShown ? auraChart!.from : chart?.from}
                    to={auraShown ? auraChart!.to : chart?.to}
                  />

                  {/* Aura snapshot markers — the memo behind each point */}
                  {memos.map((m, i) => (
                    <button
                      key={`${m.ts}-${i}`}
                      type="button"
                      aria-label={`Aura memo ${i + 1}`}
                      onMouseEnter={() => setHover(i)}
                      onFocus={() => setHover(i)}
                      className={cn(
                        "absolute top-0 h-full w-3 -translate-x-1/2 cursor-default",
                        hover === i ? "opacity-100" : "opacity-70",
                      )}
                      style={{ left: `${m.frac * CHART_PLOT_RATIO * 100}%` }}
                    >
                      <span
                        className={cn(
                          "absolute left-1/2 top-1 h-2 w-2 -translate-x-1/2 rounded-full ring-2 ring-background transition-transform",
                          hover === i ? "scale-125 bg-primary" : "bg-muted-foreground",
                        )}
                      />
                      <span className="absolute inset-y-3 left-1/2 w-px -translate-x-1/2 border-l border-dashed border-border" />
                    </button>
                  ))}

                  {hover !== null && memos[hover] && (
                    <div
                      className="pointer-events-none absolute top-6 z-20 w-[236px] rounded-2xl border border-border/70 bg-card p-3 shadow-xl"
                      style={{
                        left: `min(max(${memos[hover]!.frac * CHART_PLOT_RATIO * 100}%, 132px), calc(100% - 20px))`,
                        transform: "translateX(-50%)",
                      }}
                    >
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Aura memo</span>
                        <span>{ago(memos[hover]!.ts)}</span>
                      </div>
                      <p className="mt-1.5 text-sm leading-snug text-foreground">
                        {memos[hover]!.summary}
                      </p>
                      <div className="num mt-2 text-xs text-muted-foreground">
                        index {formatIndex(memos[hover]!.aura)}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/70 pt-4 text-sm">
                  {market.outcomes.map((o) => (
                    <span key={o.id} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
                      <span className="text-muted-foreground">{o.label}</span>
                      {/* A price, so it reads in cents — the `%` duplicate is gone. */}
                      <span className="num font-semibold">{formatCents(o.pct / 100)}</span>
                    </span>
                  ))}
                  {!market.settled && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {market.deadline} window · two-sided
                    </span>
                  )}
                </div>
              </section>
            ) : (
              <section className="flex flex-col items-center gap-2 rounded-2xl border border-border/70 bg-card px-4 py-12 text-center">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-semibold">No trading window open</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  @{slug} publishes on its own interval — the next window opens automatically and
                  this page becomes tradable.
                </p>
              </section>
            )}
          </div>

          {/* Tabs own the full width of the column — no side margins */}
          <div className="mt-4">
            {/* Handle actions — icons only, named on hover */}
            <div className="px-4 sm:px-6">
              <HandleActions
                handle={`@${slug}`}
                stake={stakeFrom(h, name, symbol, index)}
                stakeStats={stakeStats}
                myStake={myStake}
              />
            </div>

            {/* Tabs */}
            <div className="mt-4 flex border-b border-border/70">
              {(
                [
                  ["feeds", "Feeds", feedsPosts.length],
                  ["trades", "Trades", trades.length],
                  ["orderbook", "Orderbook", market ? 2 : 0],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  disabled={!market && id !== "feeds"}
                  onClick={() => setTab(id)}
                  className={cn(
                    "relative flex-1 px-3 py-3 text-sm transition-colors disabled:opacity-40",
                    tab === id
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                  {count > 0 && <span className="num ml-1.5 text-xs opacity-60">{count}</span>}
                  {tab === id && (
                    <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-foreground" />
                  )}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {tab === "feeds" && (
                <div className="divide-y divide-border/60">
                  {feeds.isPending && (
                    <div className="space-y-3 px-4 py-4" aria-hidden="true">
                      <div className="h-3 w-1/3 animate-pulse rounded bg-secondary/40" />
                      <div className="h-3 w-full animate-pulse rounded bg-secondary/30" />
                    </div>
                  )}
                  {feedsPosts.map((p) => (
                    <FeedItem key={p.id} post={p} variant="compact" />
                  ))}
                  {!feeds.isPending && feedsPosts.length === 0 && (
                    <p className="px-4 py-8 text-sm text-muted-foreground">
                      No tea from @{slug} yet — it&apos;ll show as its sources report.
                    </p>
                  )}
                  {feeds.hasNextPage && (
                    <InfiniteSentinel
                      ready={!feeds.isFetchingNextPage}
                      onEnd={() => void feeds.fetchNextPage()}
                    />
                  )}
                </div>
              )}

              {tab === "trades" && viewed && (
                <div className="overflow-x-auto">
                  <div className="min-w-[560px]">
                    <div className="grid grid-cols-[1fr_84px_76px_92px] items-center gap-3 border-b border-border/70 px-4 pb-3 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[1fr_96px_80px_96px_96px_64px] sm:px-6">
                    <span>Trader</span>
                    <span>Side</span>
                    <span className="text-right">Price</span>
                    <span className="hidden text-right sm:block">Shares</span>
                    <span className="text-right">Value</span>
                    <span className="hidden text-right sm:block">When</span>
                  </div>

                  {trades.length === 0 && (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-6">
                      No trades yet — first mover&apos;s still up for grabs.
                    </p>
                  )}

                  {trades.map((t) => {
                    const label = viewed.outcomes[t.outcome] ?? `#${t.outcome}`;
                    const isBuy = t.kind === "BUY";
                    return (
                      <div
                        key={t.id}
                        className="grid grid-cols-[1fr_84px_76px_92px] items-center gap-3 border-b border-border/50 px-4 py-3 text-sm transition-colors last:border-0 hover:bg-secondary/25 sm:grid-cols-[1fr_96px_80px_96px_96px_64px] sm:px-6"
                      >
                        <span className="num truncate text-muted-foreground">
                          {shortUser(t.user.id)}
                        </span>
                        <span
                          className={cn(
                            "truncate text-xs font-semibold",
                            isBuy ? "text-up" : "text-down",
                          )}
                        >
                          {isBuy ? "buy" : "sell"} {label}
                        </span>
                        <span className="num text-right text-muted-foreground">
                          {formatCents(Number(t.price) / 1e18)}
                        </span>
                        <span className="num hidden text-right sm:block">
                          {(Number(t.shares) / 1e18).toFixed(2)}
                        </span>
                        <span className="flex justify-end">
                          <UsdcAmount value={formatUsd(Number(t.premium) / 1e18)} size={12} />
                        </span>
                        <span className="hidden text-right text-xs text-muted-foreground sm:block">
                          {ago(Number(t.ts) * 1000)}
                        </span>
                      </div>
                    );
                  })}

                  {tradesQuery.hasNextPage && (
                    <InfiniteSentinel
                      ready={!tradesQuery.isFetchingNextPage}
                      onEnd={() => void tradesQuery.fetchNextPage()}
                    />
                  )}
                  </div>
                </div>
              )}

              {tab === "orderbook" && market && viewed && (
                <OrderBook window={viewed} outcome={picked} onOutcome={setPicked} />
              )}
            </div>
          </div>
        </div>
      </TooltipProvider>
    </FeedLayout>
  );
}

type StakeHandle = React.ComponentProps<typeof StakePopup>["handle"];

/** Label/value row used by the market panel. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num text-foreground">{children}</dd>
    </div>
  );
}

function stakeFrom(h: IndexerHandle, name: string, symbol: string, aura: number): StakeHandle {
  return {
    id: h.id,
    name,
    symbol: h.symbol ?? symbol,
    aura,
    sources: h.sources ?? [],
    stake: h.stake,
    pool: "",
    contract: h.contract,
  };
}

/** Follow · stake · notify · share — compact actions, stake named and animated. */
function HandleActions({
  handle,
  stake,
  stakeStats,
  myStake,
}: {
  handle: string;
  stake: StakeHandle;
  /** Total AURA staked on this handle (vault totalAssets). */
  stakeStats?: { totalAssets: number; valuePerToken: number };
  /** The viewer's own stake: receipts + their AURA value. */
  myStake?: { shares: number; earned: number };
}) {
  const { isFollowing, toggleFollow } = useSocial();
  const following = isFollowing(handle);
  const hasVault = !!stake.stake && stake.stake !== "0x";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => toggleFollow(handle)}
        className={cn(
          "min-h-11 rounded-full px-4 text-sm font-semibold transition-colors",
          following
            ? "border border-border text-foreground hover:border-down/60 hover:text-down"
            : "bg-foreground text-background hover:opacity-90",
        )}
      >
        {following ? "Following" : "Follow"}
      </button>

      {hasVault && (
        <Tooltip>
          <StakePopup handle={stake} trigger={<StakeButton />} />
          <TooltipContent>
            Stake AURA on @{handle.replace("@", "")} — earn from its deposit fees and rewards
          </TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Notify me"
            onClick={() =>
              toast.info("Notifications", { description: `Bet — we'll ping you on ${handle}.` })
            }
            className={ICON_BTN}
          >
            <Bell className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Notify me</TooltipContent>
      </Tooltip>

      {/* Staking is a core signal — say how much AURA is behind this handle. */}
      {hasVault && (
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Staked</dt>
            <dd className="num font-semibold text-foreground">
              {stakeStats
                ? formatCompact(stakeStats.totalAssets)
                : "—"}
              <span className="ml-1 text-xs font-medium text-muted-foreground">AURA</span>
            </dd>
          </div>
          {myStake && (
            <>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-muted-foreground">Yours</dt>
                <dd className="num font-semibold text-foreground">
                  {formatCompact(myStake.earned)}
                  <span className="ml-1 text-xs font-medium text-muted-foreground">AURA</span>
                </dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-muted-foreground">Receipts</dt>
                <dd className="num text-foreground">
                  {formatCompact(myStake.shares)}
                </dd>
              </div>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
