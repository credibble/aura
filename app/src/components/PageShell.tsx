import type { ReactNode } from "react";
import { FeedLayout } from "@/components/social/FeedLayout";
import { HomeSidebar } from "@/components/social/RightSidebar";
import { cn } from "@/lib/utils";

/**
 * X-style page chrome for every non-feed page: left rail + center column +
 * right sidebar (the standard home rail by default). Keeps short pages from
 * looking stubby without per-route hacks.
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
    <FeedLayout wide sidebar={sidebar ?? <HomeSidebar />}>
      {header}
      <div className={cn("px-4 py-5 sm:px-6", mainClassName)}>{children}</div>
    </FeedLayout>
  );
}
