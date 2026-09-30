import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The three states every data surface must be able to show.
 *
 * Why this exists: the app had empty + loading states everywhere but almost no
 * ERROR state. A failed query doesn't throw, so it never reached the root error
 * boundary — a subgraph/RPC outage rendered as a silently EMPTY page, which
 * reads as "there is nothing here" instead of "this failed".
 */
export function QueryError({
  what = "this",
  onRetry,
  className,
}: {
  /** What failed, for the copy: "markets", "your positions", … */
  what?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-border/70 px-6 py-10 text-center",
        className,
      )}
    >
      <AlertTriangle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-foreground">Couldn't load {what}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          The index is unreachable right now — it usually comes back in a moment.
        </p>
      </div>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** A quiet inline "loading…" for the places a skeleton would be too heavy. */
export function QueryLoading({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex items-center justify-center gap-2 py-8 text-[13px] text-muted-foreground", className)}
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Loading…
    </div>
  );
}

/**
 * Renders `error` when a query failed, `empty` when it succeeded with nothing,
 * and `children` otherwise — so a surface can't forget one of the three.
 */
export function QueryState({
  error,
  onRetry,
  what,
  isEmpty,
  empty,
  children,
}: {
  error: boolean;
  onRetry?: () => void;
  what?: string;
  isEmpty?: boolean;
  empty?: ReactNode;
  children: ReactNode;
}) {
  if (error) return <QueryError what={what} onRetry={onRetry} />;
  if (isEmpty && empty) return <>{empty}</>;
  return <>{children}</>;
}
