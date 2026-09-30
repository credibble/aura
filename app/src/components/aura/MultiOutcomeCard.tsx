import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { AuraText } from "@/components/aura/AuraTerm";
import { Avatar } from "@/components/Avatar";
import { cents } from "@/components/aura/pm";
import { FadeBox } from "@/components/ScrollRow";
import { CATEGORY_MAP, METRIC_LABEL } from "@/lib/aura-data";
import { type Market } from "@/lib/aura-markets";
import { handleSlug } from "@/lib/handle-id";
import { formatCompact } from "@/lib/format";
import { UsdcAmount } from "@/components/aura/UsdcIcon";
import { useHandleArtwork } from "@/queries/handles";
import { cn } from "@/lib/utils";

/**
 * Card for markets with three or more outcomes. Two-outcome markets keep the
 * compact Yes/No card — same `Market` data underneath, just a different layout.
 * Header and footer stay pinned; the outcome list scrolls inside the card's
 * row height with a fade at the end, so 3+ cards match the 2-way card height.
 */
export function MultiOutcomeCard({ market }: { market: Market }) {
  const cat = CATEGORY_MAP[market.category];
  const artwork = useHandleArtwork();

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-secondary text-[11px]">
            {cat.icon}
          </span>
          <span>{cat.label}</span>
          <span className="font-bold text-primary">{market.handle}</span>
        </div>
        <span className="num text-xs text-muted-foreground">
          <UsdcAmount value={formatCompact(market.volume)} size={12} /> Vol.
        </span>
      </div>

      <h3 className="mt-2.5 shrink-0 text-[15px] font-semibold leading-snug">
        <Link
          to="/$id"
          params={{ id: handleSlug({ id: market.id, name: market.handle }) }}
          className="hover:text-primary hover:underline"
        >
          <AuraText text={market.question} />
        </Link>
      </h3>

      <FadeBox className="mt-2 min-h-0 flex-1 divide-y divide-border/70">
        {market.outcomes.map((o, i) => (
          <Link
            key={o.id}
            to="/$id"
            params={{ id: handleSlug({ id: market.id, name: market.handle }) }}
            className="flex w-full items-center gap-2.5 py-2.5 text-left transition-colors hover:bg-secondary/30"
          >
            <span className="num w-3 shrink-0 text-[11px] text-muted-foreground">{i + 1}</span>
            <Avatar
              seed={o.label}
              image={artwork(o.label).image}
              imageFit={artwork(o.label).imageFit}
              size={24}
              alt={o.label}
              className="shrink-0"
            />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{o.label}</span>
            <span className="num w-9 shrink-0 text-right text-sm font-semibold text-foreground">
              {o.pct}%
            </span>
            <span
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-xs font-semibold transition-colors",
                i === 0
                  ? "bg-primary text-primary-foreground transition-all hover:brightness-110"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              Buy {cents(o.pct)}
            </span>
          </Link>
        ))}
      </FadeBox>

      <div className="mt-auto flex shrink-0 items-center justify-between pt-2.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" /> {market.deadline} window
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          {METRIC_LABEL[market.metric]} · {market.outcomes.length} outcomes
        </span>
      </div>
    </div>
  );
}
