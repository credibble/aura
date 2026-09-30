import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * `Stake $AURA` — the handle's staking action. The label sits inside a thin,
 * slowly panning gradient ring so the action reads as the valuable one without
 * shouting. Forwards props so it works as a dialog/popover trigger.
 */
export const StakeButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    className?: string;
    /** Full-width, taller — for sidebars and page CTAs. */
    block?: boolean;
  }
>(function StakeButton({ children = "Stake $AURA", className, block = false, ...props }, ref) {
  return (
    <span
      className={cn("gradient-ring inline-flex rounded-full p-[1.5px]", block && "flex w-full")}
    >
      <button
        ref={ref}
        type="button"
        {...props}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-full bg-card px-4 py-1.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-secondary",
          block && "w-full py-3 text-sm",
          className,
        )}
      >
        {children}
      </button>
    </span>
  );
});
