import { Link } from "@tanstack/react-router";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { AuraText } from "@/components/aura/AuraTerm";
import { UsdcAmount } from "@/components/aura/UsdcIcon";
import { CATEGORY_MAP, type CategoryId } from "@/lib/aura-data";
import { marketChange, type Market } from "@/lib/aura-markets";
import { handleSlug } from "@/lib/handle-id";
import { windowLabels } from "@/queries/handles";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

export function cents(p: number): string {
  if (p < 1) return "<1¢";
  return `${Math.round(p)}¢`;
}

export function pctLabel(v: number): string {
  if (v < 1) return "<1%";
  if (v > 99) return ">99%";
  return `${Math.round(v)}%`;
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** Real move since window open — ▲/▼ chip with whole points. */
export function DeltaChip({ delta }: { delta: number }) {
  if (delta === 0) return null;
  return (
    <span className={cn("num text-xs font-semibold", delta > 0 ? "text-up" : "text-down")}>
      {delta > 0 ? "▲" : "▼"}
      {Math.abs(Math.round(delta))}
    </span>
  );
}

function handleSymbol(market: Market): string {
  return market.handle.replace("@", "").toUpperCase().slice(0, 2) || "AU";
}

function Vol({ market }: { market: Market }) {
  return (
    <div className="mt-auto flex items-center justify-between pt-3 text-xs text-muted-foreground">
      <span className="num flex items-center gap-1">
        <UsdcAmount value={formatCompact(market.volume)} size={12} /> Vol.
      </span>
    </div>
  );
}

/** Binary card — one Yes/No question, live probability, split bar, trade link. */
export function MarketCard({ market }: { market: Market }) {
  const cat = CATEGORY_MAP[market.category as CategoryId];
  const yes = clampPct(market.outcomes[0]?.pct ?? 0);
  const no = clampPct(market.outcomes[1]?.pct ?? 0);
  const move = marketChange(market);

  return (
    <Link
      to="/$id"
      params={{
        id: handleSlug({ id: market.handleId, name: market.handle, symbol: handleSymbol(market) }),
      }}
      className="flex h-full flex-col rounded-xl border border-border bg-card p-3.5 transition-colors hover:bg-secondary/40"
    >
      <div className="flex items-start gap-2.5">
        <AssetAvatar
          asset={{
            id: market.handleId,
            symbol: handleSymbol(market),
            color: market.outcomes[0]?.color ?? "hsl(var(--primary))",
            name: market.handle,
            image: market.image,
            imageFit: market.imageFit,
            metadata: market.metadata,
          }}
          size={36}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>
              {cat.label} · {windowLabels(market.windowMinutes).short}
            </span>
            <span className="font-bold text-primary">{market.handle}</span>
          </div>
          {/* Truncated to two lines: the full question stays reachable on hover. */}
          <div
            className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-foreground"
            title={market.question}
          >
            <AuraText text={market.question} />
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <div className="text-[11px] text-muted-foreground">chance</div>
          <div className="flex items-baseline gap-1.5">
            <span className="num text-2xl font-bold leading-none tracking-tight text-foreground">
              {pctLabel(yes)}
            </span>
            <DeltaChip delta={move} />
          </div>
        </div>
        <div className="text-right text-[11px] text-muted-foreground">
          <div>
            <span className="text-up">Yes</span> {pctLabel(yes)}
          </div>
          <div>
            <span className="text-down">No</span> {pctLabel(no)}
          </div>
        </div>
      </div>

      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-down/30">
        <div
          className="h-full rounded-full bg-up transition-all duration-500"
          style={{ width: `${yes}%` }}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <span className="rounded-lg bg-up py-2 text-center text-sm font-semibold text-up-foreground transition-all group-hover:brightness-110">
          Buy Yes {cents(yes)}
        </span>
        <span className="rounded-lg bg-down py-2 text-center text-sm font-semibold text-down-foreground transition-all group-hover:brightness-110">
          Buy No {cents(no)}
        </span>
      </div>
      <Vol market={market} />
    </Link>
  );
}

/** Binary chance card — gauge + large Yes / No (same data, alternate layout). */
export function ChanceCard({ market }: { market: Market }) {
  const yes = clampPct(market.outcomes[0]?.pct ?? 0);
  const no = clampPct(market.outcomes[1]?.pct ?? 0);
  return (
    <Link
      to="/$id"
      params={{
        id: handleSlug({ id: market.handleId, name: market.handle, symbol: handleSymbol(market) }),
      }}
      className="flex h-full flex-col rounded-xl border border-border bg-card p-3.5 transition-colors hover:bg-secondary/40"
    >
      <div className="flex items-start gap-2.5">
        <AssetAvatar
          asset={{
            id: market.handleId,
            symbol: handleSymbol(market),
            color: market.outcomes[0]?.color ?? "hsl(var(--primary))",
            name: market.handle,
            image: market.image,
            imageFit: market.imageFit,
            metadata: market.metadata,
          }}
          size={36}
        />
        <div className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-snug">
          <AuraText text={market.question} />
        </div>
        <ChanceGauge value={yes} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <span className="rounded-lg bg-up py-2.5 text-center text-sm font-semibold text-up-foreground transition-all group-hover:brightness-110">
          Yes {cents(yes)}
        </span>
        <span className="rounded-lg bg-down py-2.5 text-center text-sm font-semibold text-down-foreground transition-all group-hover:brightness-110">
          No {cents(no)}
        </span>
      </div>
      <Vol market={market} />
    </Link>
  );
}

export function ChanceGauge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const label = v < 1 ? "<1%" : `${Math.round(v)}%`;
  return (
    <div className="relative grid h-12 w-12 shrink-0 place-items-center">
      <svg viewBox="0 0 36 36" className="h-12 w-12 -rotate-90">
        <circle cx="18" cy="18" r="14" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r="14"
          fill="none"
          stroke="hsl(var(--up))"
          strokeWidth="3"
          strokeDasharray={`${(v / 100) * 88} 88`}
          strokeLinecap="round"
        />
      </svg>
      <span className="num absolute text-[10px] font-bold text-foreground">{label}</span>
    </div>
  );
}
