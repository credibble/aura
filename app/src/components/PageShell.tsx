import type { ReactNode } from "react";
import { FeedLayout } from "@/components/social/FeedLayout";
import { HomeSidebar } from "@/components/social/RightSidebar";
import { cn } from "@/lib/utils";

/**
 * Page chrome for every non-feed page: left rail + center column +
 * right sidebar (the standard home rail by default). Keeps short pages from
 * looking stubby without per-route hacks.
 *
 * This is the same shell as the feed, not a parallel one: it renders
 * `FeedLayout`, so the centre column's 768px cap applies here too. The parent
 * flex row's `justify-center` centres rail + centre + aside as a group (the
 * centre no longer sets `mx-auto` itself). The leaderboard/portfolio tables sit
 * inside that measure — their 620px min-width clears it, so none of them scroll
 * sideways.
 */
export function PageShell({
  children,
  header,
  sidebar,
  mainClassName,
}: {
  children: ReactNode;
  /** Sticky center-column header (title row / tabs). */
  header?: ReactNode;
  /** Right rail — defaults to the standard home sidebar. */
  sidebar?: ReactNode;
  mainClassName?: string;
}) {
  return (
    <FeedLayout sidebar={sidebar ?? <HomeSidebar />}>
      {header}
      <div className={cn("px-4 py-5 sm:px-6", mainClassName)}>{children}</div>
    </FeedLayout>
  );
}
