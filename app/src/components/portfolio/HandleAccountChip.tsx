import { Link } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GUEST_SEED } from "@/components/Avatar";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { HandleSwitcher } from "@/components/portfolio/HandleSwitcher";
import { handleSlug } from "@/lib/handle-id";
import { cn } from "@/lib/utils";
import { GRADUATION_AURA } from "@/lib/portfolio";
import { useAuraAuth } from "@/lib/aura-auth";
import { useAuraContracts } from "@/lib/contracts";
import { useHandles } from "@/lib/handle-store";

/**
 * Account chip at the foot of the rail. Goes to `/portfolio` (positions, stake,
 * connections). The avatar's ring marks trading-graduated handles (≥100 Aura).
 *
 * `labelClassName` and `toggleClassName` let the rail hide the name/handle and
 * the theme toggle the moment it collapses — collapsed = avatar only.
 */
export function HandleAccountChip({
  labelClassName,
  toggleClassName,
}: {
  labelClassName?: string;
  toggleClassName?: string;
}) {
  const { handles, activeId } = useHandles();
  const { address } = useAuraContracts();
  const { login } = useAuraAuth();
  const active = handles.find((h) => h.id === activeId) ?? handles[0];
  const graduated = Boolean(active && active.aura >= GRADUATION_AURA);
  // Fully signed out = no wallet and no handle — the chip then signs in instead
  // of opening the portfolio (which shows the same connect wall).
  const signedIn = Boolean(address) || Boolean(active);

  return (
    <div className="mt-1 flex h-14 w-full items-center overflow-hidden rounded-full px-1 transition-colors hover:bg-secondary/70">
      <Link
        to="/me"
        className="flex h-full min-w-0 flex-1 items-center gap-3 px-1"
        aria-label={signedIn ? "Me" : "Sign in"}
        onClick={(e) => {
          if (!signedIn) {
            e.preventDefault();
            void login();
          }
        }}
      >
        <AssetAvatar
          asset={{
            id: active?.id ?? address ?? GUEST_SEED,
            symbol: (active?.symbol ?? active?.name ?? "you").toUpperCase().slice(0, 4),
            color: "hsl(var(--primary))",
            name: active?.name ?? "Account",
          }}
          size={36}
          className={cn(
            "border border-border bg-background",
            // Ring = trading-graduated (≥100 Aura) vs not.
            graduated
              ? "ring-2 ring-emerald-500 ring-offset-1 ring-offset-background"
              : "ring-1 ring-border",
          )}
        />
        <span className={cn("min-w-0 flex-1 text-left leading-tight", labelClassName)}>
          <span className="block truncate text-sm font-bold">{active?.name ?? "You"}</span>
          <span className="block truncate text-xs text-muted-foreground">
            @{active ? handleSlug(active) : "you"}
          </span>
        </span>
      </Link>
      <HandleSwitcher
        className={cn("h-8 w-8 shrink-0 rounded-full hover:bg-secondary", toggleClassName)}
      />
      <ThemeToggle
        className={cn("h-8 w-8 shrink-0 rounded-full hover:bg-secondary", toggleClassName)}
      />
    </div>
  );
}
