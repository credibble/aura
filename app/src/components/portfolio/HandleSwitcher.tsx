import { useState } from "react";
import { ArrowLeftRight, Check, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { CreateHandleDialog } from "@/components/portfolio/CreateHandleDialog";
import { setActiveHandle, useHandles, useLoadHandles } from "@/lib/handle-store";
import { useAuraContracts } from "@/lib/contracts";
import { formatIndex } from "@/lib/format";
import { START_FARMING } from "@/lib/voice";
import { cn } from "@/lib/utils";

/**
 * Handle switcher — the switch icon beside the theme toggle, next to the
 * signed-in "Me" affordance (the rail's account chip and the top navbar).
 * Opens the wallet popover primitive with one row per owned handle (artwork,
 * name/symbol, aura); picking a row updates the shared active-handle store and
 * closes the popup. The bottom action opens the existing CreateHandleDialog.
 *
 * Signed out there is no wallet to scope handles to, so it renders nothing —
 * the ConnectButton next to it is the sign-in affordance.
 */
export function HandleSwitcher({ className }: { className?: string }) {
  const { address } = useAuraContracts();
  // The rail loads the store; loading here too makes the switcher work on any
  // surface (the top navbar) without depending on mount order — same query key,
  // so react-query de-dupes the fetch.
  useLoadHandles(address ?? null);
  const { handles, activeId } = useHandles();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  if (!address) return null;

  const active = handles.find((h) => h.id === activeId) ?? handles[0];

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Switch handle"
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground",
                  className,
                )}
              >
                <ArrowLeftRight className="h-[18px] w-[18px]" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Switch handle</TooltipContent>
        </Tooltip>
        <PopoverContent align="end" sideOffset={8} className="w-72 p-2">
          <div className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">
            Your handles
          </div>
          <div className="flex flex-col">
            {handles.map((h) => {
              const isActive = h.id === (active?.id ?? activeId);
              return (
                <button
                  key={h.id}
                  type="button"
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => {
                    setActiveHandle(h.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary/60",
                    isActive && "bg-secondary/40",
                  )}
                >
                  <AssetAvatar
                    asset={{
                      id: h.id,
                      symbol: (h.symbol || h.name || "?").toUpperCase().slice(0, 4),
                      color: "hsl(var(--primary))",
                      name: h.name,
                    }}
                    size={30}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{h.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {h.symbol ? `$${h.symbol}` : `@${h.name}`}
                    </span>
                  </span>
                  <span className="num shrink-0 text-sm font-semibold">{formatIndex(h.aura)}</span>
                  {isActive && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  <span className="sr-only">
                    {isActive ? "Active handle" : "Switch to this handle"}
                  </span>
                </button>
              );
            })}
            {handles.length === 0 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                No handles yet — start farming aura to trade and publish.
              </p>
            )}
          </div>
          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-secondary/60"
            >
              <Plus className="h-4 w-4" /> {START_FARMING}
            </button>
          </div>
        </PopoverContent>
      </Popover>
      {/* Outside the popover so it outlives it: the popover's content unmounts
          on close, which would tear the dialog down with it if nested. */}
      <CreateHandleDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
