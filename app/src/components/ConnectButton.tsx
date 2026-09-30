import { useEffect, useState } from "react";
import { Copy, LogOut, Check, LogIn } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/format";
import { UsdcAmount } from "@/components/aura/UsdcIcon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuraAuth } from "@/lib/aura-auth";
import { useAuraContracts } from "@/lib/contracts";
import { CONTRACTS } from "@/lib/chain";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Privy wallet button — sign in via Privy, or the account popover once in.
 *
 * `labelClassName` controls the visibility of the text spans (address/balance
 * when connected, the CTA when not) — the left rail passes its own collapsed /
 * expanded rules so the button shrinks to icon-only like every other rail row.
 * `disconnectedLabel` customises the signed-out CTA (e.g. "Connect Wallet"). */
export function ConnectButton({
  className,
  labelClassName,
  disconnectedLabel = "Sign up",
}: {
  className?: string;
  labelClassName?: string;
  disconnectedLabel?: string;
}) {
  const { login, logout } = useAuraAuth();
  const { address, api } = useAuraContracts();
  const [copied, setCopied] = useState(false);
  const [usdc, setUsdc] = useState<bigint | null>(null);

  useEffect(() => {
    let alive = true;
    setUsdc(null);
    if (!address || !CONTRACTS.usdc) return;
    void api
      .readTokenBalance(CONTRACTS.usdc as `0x${string}`)
      .then((b) => {
        if (alive) setUsdc(b as bigint);
      })
      .catch(() => {
        if (alive) setUsdc(null);
      });
    return () => {
      alive = false;
    };
  }, [address, api]);

  const copy = () => {
    if (address) navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (!address) {
    return (
      <button
        type="button"
        onClick={() => void login()}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:brightness-110",
          className,
        )}
      >
        <LogIn className="h-3.5 w-3.5 shrink-0" />
        <span className={labelClassName}>{disconnectedLabel}</span>
      </button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-secondary/70 px-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary",
            className,
          )}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-up" />
          <span className={labelClassName ? cn("num", labelClassName) : "num hidden sm:inline"}>
            {short(address)}
          </span>
          <span className={cn("num text-muted-foreground", labelClassName)}>
            {usdc === null ? (
              "—"
            ) : (
              <UsdcAmount value={formatUsd(Number(usdc) / 1e18)} size={12} />
            )}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-64 p-2">
        <div className="rounded-lg border border-border bg-secondary/30 p-3">
          <div className="text-xs font-medium text-muted-foreground">Wallet</div>
          <div className="num mt-1 text-sm font-semibold text-foreground">{short(address)}</div>
          <div className="mt-2 text-xs text-muted-foreground">USDC balance</div>
          <div className="num text-lg font-bold text-foreground">
            {usdc === null ? (
              "—"
            ) : (
              <UsdcAmount value={formatUsd(Number(usdc) / 1e18)} size={16} />
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-col">
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary/60"
          >
            {copied ? <Check className="h-4 w-4 text-up" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy address"}
          </button>
          {/* Disconnecting drops the session and the wallet — ask first. */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-down transition-colors hover:bg-secondary/60"
              >
                <LogOut className="h-4 w-4" />
                Disconnect
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect this wallet?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your handle, stake and positions stay on-chain — you just sign out of the app.
                  You can reconnect any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep me signed in</AlertDialogCancel>
                <AlertDialogAction onClick={() => void logout()}>Disconnect</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </PopoverContent>
    </Popover>
  );
}
