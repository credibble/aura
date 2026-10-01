import { Link } from "@tanstack/react-router";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { ActivityChart } from "@/components/aura/charts";
import type { LiveAsset } from "@/lib/aura-data";
import { handleSlug } from "@/lib/handle-id";
import { formatCompact, formatIndex, formatPct } from "@/lib/format";
import { trendColor } from "@/lib/chart-domain";
import { UsdcAmount } from "@/components/aura/UsdcIcon";
import { cn } from "@/lib/utils";

/**
 * Explore card — the handle's avatar, name and volume on top, its live aura
 * index and move on the right, and the index history as a full-bleed chart.
 * Up/down tints the whole line like the reference; nothing else competes.
 */
export function SparkCard({ asset, className }: { asset: LiveAsset; className?: string }) {
  const up = asset.change >= 0;
  // One rule for every chart: green when the trend is up, red when it is down.
  const color = trendColor(asset.history, asset.change);
  // Real history when the indexer has more than one point; otherwise draw the
  // latest real move (index − delta → index) so a young handle still shows the
  // movement it has instead of a dead flat line.
  const data =
    asset.history.length > 1
      ? asset.history
      : asset.change !== 0
        ? [asset.index - asset.change, asset.index]
        : [asset.index, asset.index];

  return (
    <Link
      to="/$id"
      params={{ id: handleSlug(asset) }}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card p-3.5 transition-colors hover:border-border hover:bg-secondary/30",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AssetAvatar
          asset={{
            id: asset.id,
            symbol: asset.symbol,
            color: "hsl(var(--primary))",
            name: asset.name,
            image: asset.image,
            imageFit: asset.imageFit,
          }}
          size={34}
        />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-semibold text-foreground">{asset.name}</div>
          <div className="num truncate text-xs text-muted-foreground">
            <UsdcAmount
              value={`${formatCompact(asset.volume)}`}
              size={11}
              className="font-normal"
            />{" "}
            Vol.
          </div>
        </div>
        <div className="shrink-0 text-right leading-tight">
          <div className="num text-sm font-semibold text-foreground">
            {formatIndex(asset.index)}
          </div>
          <div className={cn("num text-xs font-semibold", up ? "text-up" : "text-down")}>
            {formatPct(asset.change)}
          </div>
        </div>
      </div>

      {/* Full-bleed history — the card's edge-to-edge signal */}
      <div className="-mx-3.5 -mb-3.5 mt-2.5">
        <ActivityChart data={data} color={color} height={112} padX={0} strokeWidth={1.75} />
      </div>
    </Link>
  );
}
