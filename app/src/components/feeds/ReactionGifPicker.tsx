import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Smile } from "lucide-react";
import { cn } from "@/lib/utils";

/** The reaction GIFs shipped with the app (public/gifs/reaction_N.gif). */
export const REACTION_GIFS = Array.from({ length: 22 }, (_, i) => `/gifs/reaction_${i + 1}.gif`);

/**
 * Reaction picker — one small popover of the bundled GIFs. Picking one attaches
 * it to the comment being written; it never navigates or loads the file twice.
 */
export function ReactionGifPicker({
  onPick,
  className,
}: {
  onPick: (src: string) => void;
  className?: string;
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Add a reaction GIF"
              className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                className,
              )}
            >
              <Smile className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Reaction GIF</TooltipContent>
      </Tooltip>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(340px,calc(100vw-2rem))] rounded-2xl border-border/70 bg-card p-3 shadow-xl"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Reactions
          </span>
        </div>
        <div className="grid max-h-[260px] grid-cols-3 gap-2 overflow-y-auto scroll-thin pr-0.5">
          {REACTION_GIFS.map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => onPick(src)}
              className="overflow-hidden rounded-xl border border-border/60 bg-secondary/40 transition-transform hover:scale-[1.03]"
            >
              <img src={src} alt="" loading="lazy" className="h-[74px] w-full object-cover" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
