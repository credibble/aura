import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowDownRight,
  ChevronLeft,
  ChevronRight,
  Droplets,
  LogIn,
  Wallet,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { useAuraAuth } from "@/lib/aura-auth";
import { useAuraContracts } from "@/lib/contracts";
import { useTradeExecutor } from "@/lib/trade";
import { cn } from "@/lib/utils";
import { handleSlug } from "@/lib/handle-id";
import { formatCents, formatCompact, formatUsd } from "@/lib/format";
import { summarisePositions } from "@/lib/portfolio-summary";
import { QueryError } from "@/components/QueryState";
import { useHandleArtwork } from "@/queries/handles";
import { UsdcAmount } from "@/components/aura/UsdcIcon";
import { Skeleton } from "@/components/ui/skeletons";
import {
  ORDERS_PAGE_SIZE,
  ordersPageOptions,
  positionsOptions,
  useOpenOrdersLive,
  usePositionsLive,
  type OrderTab,
  type PositionTrade,
} from "@/queries/user";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [{ title: "Portfolio - Aura" }],
  }),
  component: PortfolioPage,
});

/** Rows per page in each positions tab. */
const POSITIONS_PAGE_SIZE = 8;

type ViewPosition = {
  key: string;
  windowId: string;
  handleId: string;
  handle: string;
  question: string;
  oracle: string;
  outcomeIdx: number;
  outcomeLabel: string;
  /** HUMAN shares (already divided by 1e18) — see `derivePositions`. */
  shares: number;
  /** USDC spent/received, human units. */
  cost: number;
  entry: number;
  price: number;
  settled: boolean;
  winning: number | null;
  /** Settled winning shares still unclaimed — redeemable 1 USDC per share. */
  claimable: number;
  /** No remaining exposure: sold out, claimed, voided, or lost at settlement. */
  closed: boolean;
};

/** Aggregate the trade history into one position row per (window, outcome). */
function derivePositions(rows: PositionTrade[]): ViewPosition[] {
  const byKey = new Map<string, ViewPosition & { costAcc: number }>();
  for (const t of rows) {
    const key = `${t.window.id}:${t.outcome}`;
    let row = byKey.get(key);
    if (!row) {
      const handle = t.window.handle;
      const display = `@${(handle.symbol ?? handle.name ?? handle.id).toLowerCase()}`;
      row = {
        key,
        windowId: t.window.id,
        handleId: handle.id,
        handle: display,
        question: t.window.question,
        oracle: t.window.oracle,
        outcomeIdx: t.outcome,
        outcomeLabel: t.window.outcomes[t.outcome] ?? `Outcome ${t.outcome}`,
        shares: 0,
        cost: 0,
        entry: 0,
        price: Number(t.window.prices[t.outcome] ?? 0) / 1e18,
        settled: t.window.settled,
        winning: t.window.winningOutcome,
        claimable: 0,
        closed: false,
        costAcc: 0,
      };
      byKey.set(key, row);
    }
    // `t.shares` is outcome-token WEI (1e18). Every other amount here is scaled
    // on read (`premium`, `proceeds`, `prices`) — skipping it here made shares
    // 1e18× too large, which is why Equity/Claimable/PnL read as 195,180,496.6T
    // and the entry price rounded to 0.00.
    const shares = Number(t.shares) / 1e18;
    if (t.kind === "BUY") {
      row.shares += shares;
      row.costAcc += Number(t.premium) / 1e18;
    } else if (t.kind === "SELL") {
      row.shares -= shares;
      row.costAcc -= Number(t.proceeds) / 1e18;
    } else if (t.kind === "CLAIM") {
      row.shares -= shares;
      row.costAcc -= Number(t.proceeds) / 1e18;
    } else if (t.kind === "VOID") {
      // Void refunds carry proceeds but zero shares (see the indexer's
      // VoidRedeemed handler) — book the money, not a phantom share burn.
      row.shares -= shares;
      row.costAcc -= Number(t.proceeds) / 1e18;
    } else if (t.kind === "TRANSFER_OUT") {
      // Order-book fills move shares through MarketMaker.transferFrom, which the
      // indexer records as a transfer pair — the claim follows the shares.
      row.shares -= shares;
    } else if (t.kind === "TRANSFER_IN") {
      row.shares += shares;
    }
    // Track the freshest price/labels from the newest trade (rows are desc).
    row.price = Number(t.window.prices[t.outcome] ?? 0) / 1e18;
    row.settled = t.window.settled;
    row.winning = t.window.winningOutcome;
  }
  const out: ViewPosition[] = [];
  for (const row of byKey.values()) {
    if (row.settled && row.winning !== null) {
      // Settled: winning shares are worth 1, losing shares are worth 0.
      row.price = row.winning === row.outcomeIdx ? 1 : 0;
    }
    const settledWinning = row.settled && row.winning === row.outcomeIdx;
    if (settledWinning && row.shares > 0) row.claimable = row.shares;
    // Open = a live position: shares held on an unsettled window, OR winning
    // settled shares still awaiting their claim. Everything else has no
    // remaining exposure and belongs in the Closed tab.
    row.closed = !(row.shares > 0 && (!row.settled || settledWinning));
    row.entry = row.shares > 0 && row.costAcc > 0 ? row.costAcc / row.shares : 0;
    row.cost = row.costAcc;
    out.push(row);
  }
  return out;
}

function PortfolioPage() {
  const { address } = useAuraContracts();
  const { login } = useAuraAuth();
  const exec = useTradeExecutor();
  const artwork = useHandleArtwork();

  const [posTab, setPosTab] = useState<"open" | "closed">("open");
  const [posPage, setPosPage] = useState(1);
  const [ordTab, setOrdTab] = useState<OrderTab>("open");
  const [ordPage, setOrdPage] = useState(1);

  // Positions are aggregated from the wallet's full trade history (a position
  // needs every trade for its window, so the pages are sliced after deriving).
  const positionsQuery = useQuery(positionsOptions(address ?? undefined));
  // Orders page straight from the indexer with a real limit/offset per page.
  const ordersQuery = useQuery(ordersPageOptions(address ?? undefined, ordTab, ordPage));
  // The wallet's positions + resting orders are indexer-streamed.
  usePositionsLive(address ?? undefined);
  useOpenOrdersLive(address ?? undefined);

  const allPositions = useMemo(
    () => derivePositions(positionsQuery.data ?? []),
    [positionsQuery.data],
  );
  const openPositions = useMemo(() => allPositions.filter((p) => !p.closed), [allPositions]);
  const closedPositions = useMemo(() => allPositions.filter((p) => p.closed), [allPositions]);

  const shownPositions = posTab === "open" ? openPositions : closedPositions;
  const posPages = Math.max(1, Math.ceil(shownPositions.length / POSITIONS_PAGE_SIZE));
  const posPageClamped = Math.min(posPage, posPages);
  const pagedPositions = shownPositions.slice(
    (posPageClamped - 1) * POSITIONS_PAGE_SIZE,
    posPageClamped * POSITIONS_PAGE_SIZE,
  );

  const orders = ordersQuery.data?.items ?? [];
  const ordersTotal = ordersQuery.data?.total ?? 0;
  const orderPages = Math.max(1, Math.ceil(ordersTotal / ORDERS_PAGE_SIZE));

  // The summary separates LIVE exposure from REALISED, unclaimed wins. Summing
  // them counted a settled winner's payout as an unrealised gain and divided it
  // by the combined cost basis of every open row. See lib/portfolio-summary.
  const summary = useMemo(() => summarisePositions(openPositions), [openPositions]);

  if (!address) {
    return (
      <PageShell
        header={
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            <span className="text-sm font-medium">Positions</span>
          </div>
        }
      >
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-center gap-3 p-12 text-center">
          <Wallet className="h-8 w-8 text-muted-foreground" />
          <p className="text-lg font-semibold">Connect a wallet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Your positions, resting orders and claims live on-chain — sign in to load them for this
            account.
          </p>
          <button
            type="button"
            onClick={() => void login()}
            className="mt-1 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-all hover:brightness-110"
          >
            <LogIn className="h-4 w-4" />
            Sign in
          </button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      header={
        <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-5 backdrop-blur-md sm:px-6 lg:sticky lg:top-0">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Portfolio</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Positions, resting orders and claims for {shortAddress(address)}.
            </p>
          </div>
          <Link
            to="/pool"
            className="flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Droplets className="h-3.5 w-3.5" /> Provide liquidity
          </Link>
        </div>
      }
    >
      <div className="space-y-10">
        {/* Summary — free-standing numbers, no cards. Unrealised and realised
            are kept apart: the former is live exposure, the latter cash a
            settled win is waiting to claim. */}
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Equity" value={<UsdcAmount value={formatUsd(summary.equity)} size={16} />} />
          <Stat
            label="Unrealised PnL"
            value={<UsdcAmount value={signedUsd(summary.unrealised)} size={16} />}
            hint={`${summary.unrealisedPct.toFixed(1)}%`}
            tone={summary.unrealised >= 0 ? "up" : "down"}
          />
          <Stat
            label="Realised PnL"
            value={<UsdcAmount value={signedUsd(summary.realised)} size={16} />}
            hint={`${summary.realisedPct.toFixed(1)}%`}
            tone={summary.realised >= 0 ? "up" : "down"}
          />
          <Stat
            label="Claimable"
            value={<UsdcAmount value={formatUsd(summary.claimable)} size={16} />}
          />
          <Stat label="Positions" value={`${summary.wins}/${summary.openCount || 0} up`} />
        </dl>

        {/* Positions — table (scrolls sideways on narrow screens) */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabBar
              value={posTab}
              onChange={(v) => {
                setPosTab(v);
                setPosPage(1);
              }}
              tabs={[
                { id: "open", label: "Open positions" },
                { id: "closed", label: "Closed positions" },
              ]}
            />
          </div>
          <div className="mt-3 overflow-x-auto">
            <div className="min-w-[620px]">
              <div className="grid grid-cols-[1fr_84px_92px] items-center gap-3 border-b border-border/70 pb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[1fr_96px_96px_110px_100px] sm:gap-4">
                <span>Market</span>
                <span className="hidden sm:block">Outcome</span>
                <span className="hidden text-right sm:block">Shares</span>
                <span className="text-right">Value</span>
                <span className="text-right">PnL</span>
              </div>

              {positionsQuery.isPending &&
                [0, 1].map((i) => (
                  <div key={i} className="py-3.5" aria-hidden="true">
                    <Skeleton className="h-4 w-full" />
                  </div>
                ))}

              {positionsQuery.isError && (
                <QueryError
                  what="your positions"
                  onRetry={() => void positionsQuery.refetch()}
                  className="my-4 border-0"
                />
              )}

              {!positionsQuery.isPending &&
                !positionsQuery.isError &&
                pagedPositions.map((p) => {
                  const value = p.closed ? 0 : p.shares * p.price;
                  // Closed rows report REALISED PnL: proceeds received minus cost.
                  const rowPnl = p.closed ? -p.cost : value - Math.max(0, p.cost);
                  return (
                    <div
                      key={p.key}
                      className="grid grid-cols-[1fr_84px_92px] items-center gap-3 border-b border-border/50 py-3.5 text-[13px] transition-colors last:border-0 hover:bg-secondary/25 sm:grid-cols-[1fr_96px_96px_110px_100px] sm:gap-4"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <AssetAvatar
                          asset={{
                            id: p.handleId,
                            symbol: p.handle.replace("@", "").toUpperCase().slice(0, 4),
                            color: "hsl(var(--primary))",
                            name: p.handle,
                            ...artwork(p.handle),
                          }}
                          size={30}
                        />
                        <Link
                          to="/$id"
                          params={{ id: handleSlug({ id: p.handleId, name: p.handle }) }}
                          className="truncate font-medium hover:underline"
                        >
                          {p.handle}
                        </Link>
                      </span>
                      <span className="hidden truncate text-muted-foreground sm:block">
                        {p.outcomeLabel}
                        {p.entry > 0 && <span className="num"> @ {formatCents(p.entry)}</span>}
                      </span>
                      <span className="num hidden text-right text-muted-foreground sm:block">
                        {p.closed ? "—" : formatCompact(p.shares)}
                      </span>
                      <span className="flex justify-end">
                        {p.closed ? (
                          <span className="num text-muted-foreground">—</span>
                        ) : (
                          <UsdcAmount value={formatUsd(value)} size={12} />
                        )}
                      </span>
                      <span
                        className={cn(
                          "flex items-center justify-end gap-0.5 text-right",
                          rowPnl >= 0 ? "text-up" : "text-down",
                        )}
                      >
                        {p.claimable > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              void exec.claim(
                                { oracle: p.oracle, handleId: p.handleId, windowId: p.windowId },
                                p.outcomeIdx,
                              )
                            }
                            className="inline-flex items-center gap-1.5 rounded-full bg-link px-3 py-1 text-[11px] font-semibold text-white transition-all hover:brightness-110"
                          >
                            Claim <UsdcAmount value={formatUsd(p.claimable)} size={11} />
                          </button>
                        ) : (
                          <>
                            {rowPnl >= 0 ? (
                              <ArrowUpRight className="h-3 w-3" />
                            ) : (
                              <ArrowDownRight className="h-3 w-3" />
                            )}
                            {formatUsd(Math.abs(rowPnl))}
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}

              {!positionsQuery.isPending &&
                !positionsQuery.isError &&
                shownPositions.length === 0 && (
                  <p className="py-6 text-[13px] text-muted-foreground">
                    {posTab === "open"
                      ? "No open positions — buy shares on any market to see them here."
                      : "No closed positions yet."}
                  </p>
                )}
            </div>
          </div>
          <Pager page={posPageClamped} pages={posPages} onPage={setPosPage} />
        </section>

        {/* Orders — table */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabBar
              value={ordTab}
              onChange={(v) => {
                setOrdTab(v);
                setOrdPage(1);
              }}
              tabs={[
                { id: "open", label: "Open orders" },
                { id: "closed", label: "Closed orders" },
              ]}
            />
          </div>
          <div className="mt-3 overflow-x-auto">
            <div className="min-w-[620px]">
              <div className="grid grid-cols-[1fr_84px_72px] items-center gap-3 border-b border-border/70 pb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[64px_1fr_120px_90px_76px] sm:gap-4">
                <span className="hidden sm:block">Side</span>
                <span>Market</span>
                <span className="hidden sm:block">Outcome</span>
                <span className="text-right">Size @ price</span>
                <span className="text-right">{ordTab === "closed" ? "Status" : "Cancel"}</span>
              </div>

              {ordersQuery.isPending && (
                <div className="py-3" aria-hidden="true">
                  <Skeleton className="h-4 w-full" />
                </div>
              )}

              {ordersQuery.isError && (
                <QueryError
                  what={ordTab === "open" ? "your open orders" : "your closed orders"}
                  onRetry={() => void ordersQuery.refetch()}
                  className="my-4 border-0"
                />
              )}

              {!ordersQuery.isPending &&
                !ordersQuery.isError &&
                orders.map((o) => (
                  <div
                    key={o.id}
                    className="grid grid-cols-[1fr_84px_72px] items-center gap-3 border-b border-border/50 py-3 text-[13px] transition-colors last:border-0 hover:bg-secondary/25 sm:grid-cols-[64px_1fr_120px_90px_76px] sm:gap-4"
                  >
                    <span
                      className={cn(
                        "hidden w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize sm:block",
                        o.side ? "bg-up/15 text-up" : "bg-down/15 text-down",
                      )}
                    >
                      {o.side ? "buy" : "sell"}
                    </span>
                    <Link
                      to="/$id"
                      params={{ id: handleSlug(o.window.handle.id) }}
                      className="min-w-0 truncate font-medium hover:underline"
                    >
                      {o.window.question}
                    </Link>
                    <span className="hidden truncate text-muted-foreground sm:block">
                      {o.window.outcomes[o.outcome] ?? `#${o.outcome}`}
                    </span>
                    <span className="num text-right text-muted-foreground">
                      {formatCompact(Number(o.size) / 1e18)} @ {formatCents(Number(o.price) / 1e18)}
                    </span>
                    <span className="flex justify-end">
                      {ordTab === "closed" ? (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                            o.status === "FILLED"
                              ? "bg-up/15 text-up"
                              : "bg-secondary text-muted-foreground",
                          )}
                        >
                          {o.status.toLowerCase()}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            void exec.cancelOrder(
                              {
                                oracle: o.window.oracle,
                                handleId: o.window.handle.id,
                                windowId: o.window.id,
                              },
                              o.id,
                            )
                          }
                          className="shrink-0 rounded-full border border-border/70 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-down/60 hover:text-down"
                        >
                          Cancel
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              {!ordersQuery.isPending && !ordersQuery.isError && orders.length === 0 && (
                <p className="py-6 text-[13px] text-muted-foreground">
                  {ordTab === "open" ? "No open orders." : "No closed orders yet."}
                </p>
              )}
            </div>
          </div>
          <Pager page={ordPage} pages={orderPages} onPage={setOrdPage} />
        </section>

        {/* Liquidity lives on its own page */}
        <Link
          to="/pool"
          className="flex items-center gap-3 rounded-2xl border border-border/70 px-4 py-3.5 transition-colors hover:bg-secondary/30"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Droplets className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-sm font-medium">Liquidity pool</span>
            <span className="block text-xs text-muted-foreground">
              Provide USDC to back every window and earn from the flow.
            </span>
          </span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </div>
    </PageShell>
  );
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** USDC with a leading sign only when the amount is non-zero. */
function signedUsd(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${formatUsd(Math.abs(n))}`;
}

/** Quiet segmented control used for the Open/Closed tabs. */
function TabBar<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: { id: T; label: string }[];
}) {
  return (
    <div role="tablist" className="flex gap-1 rounded-xl bg-secondary/50 p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
            value === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Numbered pager — page N is a real query slice (`limit`/`offset`), not a scroll
 * window. Shows `1 … 4 5 6 … 12` with prev/next and the current page marked.
 */
function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  const current = Math.min(page, pages);
  const items = pageItems(current, pages);
  const stepBtn =
    "grid h-8 w-8 place-items-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-center gap-1">
      <button
        type="button"
        aria-label="Previous page"
        disabled={current <= 1}
        onClick={() => onPage(current - 1)}
        className={stepBtn}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {items.map((item, i) =>
        item === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            aria-current={item === current ? "page" : undefined}
            onClick={() => onPage(item)}
            className={cn(
              "num h-8 min-w-8 rounded-md px-2 text-xs font-semibold transition-colors",
              item === current
                ? "bg-primary text-primary-foreground"
                : "border border-border/70 text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        aria-label="Next page"
        disabled={current >= pages}
        onClick={() => onPage(current + 1)}
        className={stepBtn}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

/** `1 … 4 5 6 … 12` — first, last, and a window around the current page. */
function pageItems(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const items: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) items.push("…");
  for (let p = start; p <= end; p++) items.push(p);
  if (end < pages - 1) items.push("…");
  items.push(pages);
  return items;
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "up" | "down";
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "num mt-1 text-xl font-bold",
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-foreground",
        )}
      >
        {value}
        {hint && <span className="ml-1.5 text-xs font-medium opacity-80">({hint})</span>}
      </dd>
    </div>
  );
}
