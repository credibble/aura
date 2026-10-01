import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { orderbookOptions, useOrderbookLive, type IndexerWindow } from "@/queries/markets";
import { UsdcIcon } from "@/components/aura/UsdcIcon";
import { formatCents, formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

type Level = { priceCents: number; shares: number };

/**
 * Collapsible depth ladder built from the indexer's RESTING orders for one
 * window (asks above, bids below, real sizes) — kept fresh by a subscription.
 * Tabs track the page's selected outcome.
 */
export function OrderBook({
  window: win,
  outcome,
  onOutcome,
}: {
  window: IndexerWindow;
  outcome: number;
  onOutcome: (i: number) => void;
}) {
  const bookQuery = useQuery(orderbookOptions(win.id));
  // Patched in place from the Order/OrderFill subscription while the tab is open.
  useOrderbookLive(win.id);

  const book = bookQuery.data?.books.find((b) => b.outcome === outcome);
  // A price is a fraction of a dollar on-chain (1e18); the level keeps the
  // cent price (0–100, one decimal) so the row's own arithmetic stays in cents.
  const lastPrice = Number(win.prices[outcome] ?? 0) / 1e18;

  const { asks, bids, spreadCents } = useMemo(() => {
    const toLevels = (
      rows: { price: string; size: string }[] | undefined,
      desc: boolean,
    ): Level[] =>
      (rows ?? [])
        .map((l) => ({
          priceCents: Number(l.price) / 1e16,
          shares: Number(l.size) / 1e18,
        }))
        .filter((l) => l.shares > 0)
        .sort((a, b) => (desc ? b.priceCents - a.priceCents : a.priceCents - b.priceCents));
    const askRows = toLevels(book?.asks, false); // lowest ask first
    const bidRows = toLevels(book?.bids, true); // highest bid first
    const spread =
      askRows.length > 0 && bidRows.length > 0
        ? askRows[0]!.priceCents - bidRows[0]!.priceCents
        : null;
    return { asks: askRows.slice(0, 8), bids: bidRows.slice(0, 8), spreadCents: spread };
  }, [book]);

  const maxShares = Math.max(1, ...asks.map((a) => a.shares), ...bids.map((b) => b.shares));
  const labels = win.outcomes;

  const row = (l: Level, dir: "up" | "down") => (
    <div
      key={`${dir}-${l.priceCents}-${l.shares}`}
      className="relative grid grid-cols-[1fr_72px_84px_92px] items-center px-1 py-2 text-sm"
    >
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0", dir === "up" ? "bg-down/10" : "bg-up/10")}
        style={{ width: `${(l.shares / maxShares) * 42}%` }}
      />
      <span className="relative" />
      <span
        className={cn(
          "num relative text-right font-semibold",
          dir === "up" ? "text-down" : "text-up",
        )}
      >
        {formatCents(l.priceCents / 100)}
      </span>
      <span className="num relative text-right text-foreground">{l.shares.toFixed(2)}</span>
      <span className="num relative text-right text-foreground">
        ${((l.shares * l.priceCents) / 100).toFixed(2)}
      </span>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          Order book <Info className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
        <span className="num flex items-center gap-1 text-xs text-muted-foreground">
          <UsdcIcon size={11} />
          {formatCompact(Number(win.volume) / 1e18)} Vol.
        </span>
      </div>

      <div className="px-4 pb-2 pt-3">
        {/* Outcome tabs — labels sit on the row's own line */}
        <div className="flex items-center justify-between gap-3 border-b border-border/70">
          <div className="flex min-w-0 gap-5 overflow-x-auto text-sm font-semibold">
            {labels.map((label, i) => (
              <button
                key={`${label}-${i}`}
                type="button"
                onClick={() => onOutcome(i)}
                className={cn(
                  "relative shrink-0 py-2.5 transition-colors",
                  outcome === i ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {outcome === i && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground" />
                )}
              </button>
            ))}
          </div>
          <div className="num shrink-0 text-xs text-muted-foreground">Last: {formatCents(lastPrice)}</div>
        </div>

        <div className="mt-3 grid grid-cols-[1fr_72px_84px_92px] px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Resting orders</span>
          <span className="text-right">Price</span>
          <span className="text-right">Shares</span>
          <span className="text-right">Total</span>
        </div>

        <div className="relative mt-1">
          {asks.length === 0 && bids.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {bookQuery.isPending
                ? "Loading resting orders…"
                : "No resting orders for this outcome yet — trade at the AMM price."}
            </div>
          )}
          {/* Highest ask on top; the lowest ask sits just above the mid. */}
          {[...asks].reverse().map((l) => row(l, "up"))}

          {(asks.length > 0 || bids.length > 0) && (
            <div className="relative border-t border-border">
              <span className="absolute -top-2.5 left-0 z-10 rounded bg-down px-2 py-0.5 text-xs font-bold text-white">
                Asks
              </span>
              <div className="flex items-center justify-between py-2 text-xs text-muted-foreground">
                <span className="num">Last: {formatCents(lastPrice)}</span>
                <span className="num">
                  {spreadCents != null ? `Spread: ${formatCents(spreadCents / 100)}` : "Spread: —"}
                </span>
              </div>
              <span className="absolute -bottom-2.5 left-0 z-10 rounded bg-up px-2 py-0.5 text-xs font-bold text-white">
                Bids
              </span>
            </div>
          )}

          {bids.map((l) => row(l, "down"))}
        </div>
      </div>
    </div>
  );
}
