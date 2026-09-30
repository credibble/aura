import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Glossary term for the word "aura" inside market titles — subtle dashed
 * underline, hover (or keyboard focus) reveals a popover explaining the metric.
 * Uses the shadcn/Radix Tooltip already in the repo: it renders through a
 * Portal, so it isn't clipped by `line-clamp` / `overflow-hidden` titles.
 */
export function AuraTerm({ children = "aura" }: { children?: ReactNode }) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="cursor-help underline decoration-dashed decoration-1 underline-offset-[3px] decoration-foreground/45 transition-colors hover:text-primary hover:decoration-primary focus-visible:text-primary focus-visible:decoration-primary focus-visible:outline-none"
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-[300px] rounded-lg border border-border bg-popover p-3 text-left text-sm font-normal leading-relaxed text-popover-foreground shadow-xl"
        >
          <span className="mb-1 flex items-center gap-1.5 font-semibold text-primary">
            <Info className="h-3.5 w-3.5" /> What is aura?
          </span>
          The ± sentiment of an aggregated feed post — the single signal every Aura market trades
          on. It&apos;s computed from social, community, media and search activity across all
          sources, and moves a handle&apos;s index up or down inside its time window.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Renders a market title, wrapping every standalone mention of "aura" in the
 * hover explain popover. Non-matching text passes through untouched.
 */
export function AuraText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\baura\b)/gi);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.toLowerCase() === "aura" ? (
          <AuraTerm key={i}>{part}</AuraTerm>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}
