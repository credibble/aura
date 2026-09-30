import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Time left on a window's trade, ticking.
 *
 * `windowEnd` is when the market stops trading (the contract's own gate), so
 * this is the deadline users actually act on — and it has to tick, or the UI
 * only changes when something else happens to refetch. Formats as `mm:ss`, and
 * as `hh:mm:ss` once an hour is involved, hitting `00:00` at the deadline.
 */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function Countdown({
  windowEnd,
  className,
  label = "until trading closes",
  now: externalNow,
}: {
  /** The market's windowEnd, in milliseconds (as `toMarket` normalizes it). */
  windowEnd: number;
  className?: string;
  label?: string;
  /**
   * Optional externally-driven clock (ms). When supplied the component runs no
   * timer of its own, so a parent's single tick can drive both the readout and
   * its own deadline logic. Omitted, it keeps its own second-aligned timer.
   */
  now?: number;
}) {
  const [internalNow, setInternalNow] = useState(() => Date.now());
  const now = externalNow ?? internalNow;

  useEffect(() => {
    if (externalNow !== undefined) return;
    // Align each tick to the second boundary so the digits never skip.
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now();
      setInternalNow(current);
      timer = setTimeout(tick, 1000 - (current % 1000));
    };
    timer = setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => clearTimeout(timer);
  }, [externalNow]);

  const remaining = Math.max(0, windowEnd - now);
  const closed = remaining <= 0;
  const text = formatRemaining(remaining);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-medium tabular-nums",
        closed ? "text-muted-foreground" : "text-foreground",
        className,
      )}
      title={`${label}: ${new Date(windowEnd).toLocaleString()}`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", closed ? "bg-muted-foreground" : "animate-pulse bg-[hsl(var(--up))]")} aria-hidden />
      {closed ? "Trading closed" : text}
      {!closed && <span className="sr-only"> {label}</span>}
    </span>
  );
}
