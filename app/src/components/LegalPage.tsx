import { type ReactNode } from "react";
import { FeedLayout } from "@/components/social/FeedLayout";
import { FeedSearch, SidebarFooter } from "@/components/social/RightSidebar";

export type LegalSection = {
  heading: string;
  body: ReactNode;
};

export function LegalPage({
  title,
  intro,
  updated,
  sections,
}: {
  title: string;
  intro: string;
  updated: string;
  sections: LegalSection[];
}) {
  return (
    <FeedLayout
      wide
      sidebar={
        <>
          <FeedSearch />
          <SidebarFooter />
        </>
      }
    >
      <div className="w-full min-h-[80vh] px-4 py-10 sm:px-6 sm:py-14">
        <header className="border-b border-border pb-6">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{intro}</p>
          <p className="mt-3 text-xs text-muted-foreground/70">Last updated: {updated}</p>
        </header>

        {/* Table of contents */}
        <nav className="mt-6 rounded-xl border border-border bg-card p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
            On this page
          </div>
          <ol className="grid gap-1.5 sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={s.heading}>
                <a
                  href={`#section-${i + 1}`}
                  className="text-sm text-muted-foreground hover:text-primary"
                >
                  {i + 1}. {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-8 space-y-8">
          {sections.map((s, i) => (
            <section key={s.heading} id={`section-${i + 1}`} className="scroll-mt-20">
              <h2 className="text-lg font-bold tracking-tight">
                {i + 1}. {s.heading}
              </h2>
              <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </div>
    </FeedLayout>
  );
}
