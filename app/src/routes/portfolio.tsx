import { useMemo, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ArrowDownRight, Droplets, LogIn, Wallet } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { useAuraAuth } from "@/lib/aura-auth";
import { useAuraContracts } from "@/lib/contracts";
import { useTradeExecutor } from "@/lib/trade";
import { cn } from "@/lib/utils";
import { handleSlug } from "@/lib/handle-id";
import { formatCompact, formatUsd } from "@/lib/format";
import { useHandleArtwork } from "@/queries/handles";
import { UsdcAmount } from "@/components/aura/UsdcIcon";
import { Skeleton } from "@/components/ui/skeletons";
import { openOrdersOptions, positionsOptions, type PositionTrade } from "@/queries/user";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [{ title: "Portfolio - Aura" }],
  }),
  component: PortfolioPage,
});

type ViewPosition = {
  key: string;
  windowId: string;
  handleId: string;
  handle: string;
  question: string;
  oracle: string;
  outcomeIdx: number;
  outcomeLabel: string;
  shares: number;
  cost: number;
  entry: number;
  price: number;
  settled: boolean;
  winning: number | null;
  /** Settled winning shares still unclaimed — redeemable 1 USDC per share. */
  claimable: number;
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
        costAcc: 0,
      };
      byKey.set(key, row);
    }
    const shares = Number(t.shares);
    if (t.kind === "BUY") {
      row.shares += shares;
      row.costAcc += Number(t.premium) / 1e18;
    } else if (t.kind === "SELL") {
      row.shares -= shares;
      row.costAcc -= Number(t.proceeds) / 1e18;
    } else if (t.kind === "CLAIM") {
      row.shares -= shares;
      row.costAcc -= Number(t.proceeds) / 1e18;
    } else if (t.kind === "TRANSFER_OUT") {
      // Order-book fills move shares through MarketMaker.transferFrom, which the
      // subgraph records as a transfer pair — the claim follows the shares.
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
    if (row.shares <= 0) continue;
    if (row.settled) {
      // Losing settled shares are void; winning ones await a claim.
      if (row.winning !== row.outcomeIdx) continue;
      row.claimable = row.shares;
      row.price = 1;
    }
    row.entry = row.costAcc > 0 ? row.costAcc / row.shares : 0;
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

  const positionsQuery = useQuery(positionsOptions(address ?? undefined));
  const ordersQuery = useQuery(openOrdersOptions(address ?? undefined));

  const positions = useMemo(
    () => derivePositions(positionsQuery.data ?? []),
    [positionsQuery.data],
  );
  const orders = ordersQuery.data ?? [];

  const equity = positions.reduce((s, p) => s + p.shares * p.price, 0);
  const cost = positions.reduce((s, p) => s + Math.max(0, p.cost), 0);
  const pnl = equity - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const claimable = positions.reduce((s, p) => s + p.claimable, 0);
  const wins = positions.filter((p) => p.cost > 0 && p.shares * p.price >= p.cost).length;

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
            Connect wallet
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
        {/* Summary — free-standing numbers, no cards */}
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
          <Stat label="Equity" value={<UsdcAmount value={formatUsd(equity)} size={16} />} />
          <Stat
            label="Unrealised PnL"
            value={
              <UsdcAmount value={`${pnl >= 0 ? "+" : "-"}${formatUsd(Math.abs(pnl))}`} size={16} />
            }
            hint={`${pnlPct.toFixed(1)}%`}
            tone={pnl >= 0 ? "up" : "down"}
          />
          <Stat label="Claimable" value={<UsdcAmount value={formatUsd(claimable)} size={16} />} />
          <Stat label="Positions" value={`${wins}/${positions.length || 0} up`} />
        </dl>

        {/* Open positions — table (scrolls sideways on narrow screens) */}
        <section>
          <h2 className="text-sm font-semibold">Open positions</h2>
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

            {!positionsQuery.isPending &&
              positions.map((p) => {
                const value = p.shares * p.price;
                const rowPnl = value - Math.max(0, p.cost);
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
                      {p.entry > 0 && <span className="num"> @ {p.entry.toFixed(2)}</span>}
                    </span>
                    <span className="num hidden text-right text-muted-foreground sm:block">
                      {formatCompact(p.shares)}
                    </span>
                    <span className="flex justify-end">
                      <UsdcAmount value={formatUsd(value)} size={12} />
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

            {!positionsQuery.isPending && positions.length === 0 && (
              <p className="py-6 text-[13px] text-muted-foreground">
                No open positions — buy shares on any market to see them here.
              </p>
            )}
            </div>
          </div>
        </section>

        {/* Open orders — table */}
        <section>
          <h2 className="text-sm font-semibold">Open orders</h2>
          <div className="mt-3 overflow-x-auto">
            <div className="min-w-[620px]">
              <div className="grid grid-cols-[1fr_84px_72px] items-center gap-3 border-b border-border/70 pb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[64px_1fr_120px_90px_76px] sm:gap-4">
              <span className="hidden sm:block">Side</span>
              <span>Market</span>
              <span className="hidden sm:block">Outcome</span>
              <span className="text-right">Size @ price</span>
              <span className="text-right">Cancel</span>
            </div>

            {ordersQuery.isPending && (
              <div className="py-3" aria-hidden="true">
                <Skeleton className="h-4 w-full" />
              </div>
            )}

            {!ordersQuery.isPending &&
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
                    {formatCompact(Number(o.size) / 1e18)}{" "}
                    @ {(Number(o.price) / 1e16).toFixed(1)}¢
                  </span>
                  <span className="flex justify-end">
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
                  </span>
                </div>
              ))}
            {!ordersQuery.isPending && orders.length === 0 && (
              <p className="py-6 text-[13px] text-muted-foreground">No open orders.</p>
            )}
            </div>
          </div>
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
