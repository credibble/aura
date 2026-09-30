import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";

/**
 * Skeletons that RHYME with the UI: same card radius, same paddings, same
 * avatar squares, same line heights and rhythm as the real components they
 * replace. One `Skeleton` primitive (shimmer sweep) + composed loaders.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return <span className={cn("shimmer block rounded-md bg-secondary/40", className)} style={style} />;
}

/** Square identicon placeholder — same shape as <Avatar>. */
export function SkeletonAvatar({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("shimmer block shrink-0 rounded-[24%] bg-secondary/50", className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Card shell matching the app's panels (rounded-2xl, hairline border). */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border/70 bg-card p-4", className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-32" />
      <Skeleton className="mt-3 h-[90px] w-full rounded-xl" />
    </div>
  );
}

/** Explore grid tile — avatar, name/volume, index/change, full-bleed chart. */
export function SparkCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card p-3.5">
      <div className="flex items-start gap-2.5">
        <SkeletonAvatar size={34} />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="mt-1.5 h-3 w-14" />
        </div>
        <div className="shrink-0 text-right">
          <Skeleton className="ml-auto h-3.5 w-12" />
          <Skeleton className="ml-auto mt-1.5 h-3 w-10" />
        </div>
      </div>
      <Skeleton className="mt-3 h-[104px] w-full rounded-xl" />
    </div>
  );
}

/** One digest — mirrors <FeedItem variant="row"> and "compact". */
export function FeedItemSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn(compact ? "px-4 py-4" : "px-4 py-5 sm:px-6")}>
      <div className="flex items-center gap-3">
        <SkeletonAvatar size={compact ? 32 : 38} />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="mt-1.5 h-2.5 w-20" />
        </div>
        {!compact && <Skeleton className="h-6 w-16 rounded-full" />}
      </div>
      <Skeleton className={cn("w-3/4", compact ? "mt-2.5 h-3.5" : "mt-3 h-4")} />
      <Skeleton className="mt-2 h-3 w-full" />
      <Skeleton className="mt-1.5 h-3 w-5/6" />
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
        {!compact && <Skeleton className="h-5 w-24 rounded-full" />}
      </div>
      <div className="mt-3 flex items-center gap-4">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-10" />
        {!compact && <Skeleton className="ml-auto h-3 w-24" />}
      </div>
    </div>
  );
}

/** Handle page hero — big avatar, name, index + change. */
export function HandleHeaderSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-4 sm:px-6">
      <SkeletonAvatar size={56} />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-3 w-28" />
      </div>
      <div className="shrink-0 text-right">
        <Skeleton className="ml-auto h-6 w-16" />
        <Skeleton className="ml-auto mt-2 h-3 w-12" />
      </div>
    </div>
  );
}

/** Chart panel — pills row + plot area + legend row. */
export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-6 w-9 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      {/* Varied bar heights read like a real series, not a gray block */}
      <div className="flex items-end gap-1" style={{ height }}>
        {Array.from({ length: 24 }, (_, i) => (
          <Skeleton key={i} className="flex-1 rounded-md" style={{ height: `${18 + ((i * 37) % 60)}%` }} />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 border-t border-border/70 pt-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="ml-auto h-3 w-24" />
      </div>
    </div>
  );
}

/** Market facts + stake block in the trade sidebar. */
export function MarketPanelSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/70 bg-card p-4">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary/50 p-1">
          <Skeleton className="h-8 rounded-lg" />
          <Skeleton className="h-8 rounded-lg" />
        </div>
        <Skeleton className="mx-auto mt-4 h-9 w-28" />
        <Skeleton className="mt-4 h-12 w-full rounded-xl" />
      </div>
      <div className="rounded-2xl border border-border/70 bg-card p-4">
        <Skeleton className="h-3.5 w-16" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="mt-2 flex items-center justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Table body — rows on hairlines, matching the Leaderboard/trades tables. */
export function TableSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("mt-3", className)}>
      <div className="flex items-center gap-4 border-b border-border/70 pb-3">
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-3 flex-1" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="hidden h-3 w-16 sm:block" />
        <Skeleton className="h-3 w-14" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border/50 py-3 last:border-0">
          <Skeleton className="h-3 w-6" />
          <span className="flex flex-1 items-center gap-3">
            <SkeletonAvatar size={30} />
            <span className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="mt-1.5 h-2.5 w-16" />
            </span>
          </span>
          <Skeleton className="h-3 w-12" />
          <Skeleton className="hidden h-3 w-12 sm:block" />
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

/** Comment thread entry — avatar + name row + body (+ optional GIF box). */
export function CommentSkeleton({ withGif = false }: { withGif?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-3.5">
      <SkeletonAvatar size={32} />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-2 h-3 w-2/3" />
        {withGif && <Skeleton className="mt-2 h-[92px] w-40 rounded-xl" />}
      </div>
    </div>
  );
}
