import { Loader2, TriangleAlert } from "lucide-react";
import { monad } from "@/lib/chain";
import { useChainSwitch } from "@/lib/chain-switch";
import { cn } from "@/lib/utils";

/**
 * ChainChip — the wallet's network, and a one-click way onto the right one.
 *
 * On Monad testnet it is a quiet label. On anything else it becomes a warning
 * the user can click: the app's contracts exist only on Monad, so a write from
 * another chain cannot work.
 */
export function ChainChip({ className }: { className?: string }) {
  const { hasWallet, isMonad, switching, switchToMonad } = useChainSwitch();

  // Nothing to say before a wallet is connected.
  if (!hasWallet) return null;

  if (isMonad) {
    return (
      <span
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 px-3 text-xs font-medium text-muted-foreground",
          className,
        )}
        title={`Connected to ${monad.name}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--up))]" aria-hidden />
        {monad.name}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void switchToMonad()}
      disabled={switching}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border border-[hsl(var(--down))]/40 bg-[hsl(var(--down))]/10 px-3 text-xs font-medium text-[hsl(var(--down))] transition-colors hover:bg-[hsl(var(--down))]/20 disabled:opacity-60",
        className,
      )}
      title={`This wallet is not on ${monad.name}. Click to switch.`}
    >
      {switching ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
      )}
      {switching ? "Switching…" : `Switch to ${monad.name}`}
    </button>
  );
}
