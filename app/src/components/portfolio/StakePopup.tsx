import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins, Loader2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuraContracts } from "@/lib/contracts";
import { useAuraAuth } from "@/lib/aura-auth";
import { depositFeeBps, type HandleLink } from "@/lib/portfolio";
import { formatCompact } from "@/lib/format";
import { explainRevert } from "@/lib/trade";
import { cn } from "@/lib/utils";
import { qk } from "@/queries/keys";

/**
 * Staking — deposit/withdraw AURA into the handle's Stake vault. The deposit
 * fee is a multiplier of the handle's aura (0 at no aura → 0.25% floor → 2.5%
 * cap). Writes are signed by the Privy embedded wallet via viem and WAIT for
 * the transaction receipt (confirmations) before showing success.
 *
 * Rendered as a compact sheet: one segmented control, one big amount field, a
 * two-line summary, one action. `trigger` lets callers use an icon button.
 */
export function StakePopup({ handle, trigger }: { handle: HandleLink; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState<"deposit" | "withdraw" | null>(null);
  /**
   * The EXACT 1e18 receipt amount behind a withdraw-Max click. Receipts are a
   * 1e18 ERC20 balance; rebuilding the amount from the rounded text field
   * (`BigInt(Math.round(amt * 1e18))`) can round above it and revert, so Max
   * holds the bigint and submit prefers it.
   */
  const [stakeExact, setStakeExact] = useState<bigint | null>(null);
  const { api } = useAuraContracts();
  const { auth, login } = useAuraAuth();

  const stakeAddress =
    handle.stake && handle.stake !== "0x" ? (handle.stake as `0x${string}`) : undefined;
  // The viewer's exact receipts — the source of truth for Max. Shared key with
  // /me and /:slug, so it's usually already cached.
  const sharesQuery = useQuery({
    queryKey: qk.stake("shares", stakeAddress ?? "", auth.address ?? ""),
    queryFn: () =>
      api.readStakeShares(
        stakeAddress!,
        auth.address ? (auth.address as `0x${string}`) : undefined,
      ),
    enabled: open && tab === "withdraw" && !!stakeAddress && !!auth.address,
  });

  const amt = Number(amount) || 0;
  const feeBps = depositFeeBps(handle.aura);
  const fee = (amt * feeBps) / 10_000;
  const net = amt - fee;

  const submit = async () => {
    if (!stakeAddress) {
      toast.error("Stake address not deployed for this handle yet");
      return;
    }
    const typedWei = BigInt(Math.round(amt * 1e18));
    // Withdraw-all sends the exact receipt bigint; deposits use the typed amount.
    const wei = tab === "withdraw" && stakeExact !== null ? stakeExact : typedWei;
    if (wei <= 0n) {
      toast.error("Enter an amount");
      return;
    }
    // The vault charges a fee on deposit — the amount has to clear it to mint.
    if (tab === "deposit" && fee >= amt) {
      toast.error("Amount too small", {
        description: `The deposit fee is ${(feeBps / 100).toFixed(2)}% (${fee.toFixed(4)} AURA).`,
      });
      return;
    }
    try {
      // Pre-flight: on-chain balance/receipt checks, so a doomed tx never signs.
      if (tab === "deposit") {
        const bal = await api.readAuraBalance();
        if (bal < wei) {
          toast.error("Insufficient AURA", {
            description: `You have ${formatCompact(Number(bal) / 1e18)} AURA — this needs ${formatCompact(amt)}.`,
          });
          return;
        }
      } else {
        const held = await api.readStakeShares(stakeAddress);
        if (held < wei) {
          toast.error("Not enough stake receipts", {
            description: `You hold ${formatCompact(Number(held) / 1e18)} — withdrawing ${formatCompact(amt)}.`,
          });
          return;
        }
      }
    } catch {
      /* read failed — the transaction will surface the revert */
    }
    setPending(tab);
    try {
      if (tab === "deposit") {
        const approve = await api.ensureAuraAllowance(stakeAddress, wei);
        if (approve)
          toast.info("AURA approved", { description: "One-time approval for this vault." });
        const dep = await api.stakeDeposit(stakeAddress, wei);
        toast.success(`Staked ${formatCompact(net)} AURA (${(feeBps / 100).toFixed(2)}% fee)`, {
          description: `confirmed ${dep.hash.slice(0, 10)}…`,
        });
      } else {
        const wd = await api.stakeWithdraw(stakeAddress, wei);
        toast.success(`Withdrew ${formatCompact(amt)} shares`, {
          description: `confirmed ${wd.hash.slice(0, 10)}…`,
        });
      }
      setStakeExact(null);
      setAmount("");
      setOpen(false);
    } catch (e) {
      toast.error("Transaction failed", { description: explainRevert(e) });
    } finally {
      setPending(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            className="w-full"
            onClick={(e) => {
              if (!auth.address) {
                e.preventDefault();
                void login();
                toast.info("Connect a wallet to stake");
              }
            }}
          >
            <Coins className="h-4 w-4" /> {auth.address ? "Stake AURA" : "Connect wallet to stake"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="w-[min(92vw,380px)] max-w-[380px] gap-0 rounded-3xl border-border/70 bg-card p-5 sm:rounded-3xl">
        <DialogTitle className="text-base font-semibold">
          {tab === "deposit" ? "Stake on" : "Withdraw from"} @{handle.name}
        </DialogTitle>
        <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
          Deposit fees and rewards lift the share price for every staker.
        </DialogDescription>

        {/* Segmented control — quieter than tabs */}
        <div
          role="group"
          aria-label="Stake action"
          className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-secondary/50 p-1"
        >
          {(["deposit", "withdraw"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setStakeExact(null);
              }}
              aria-pressed={tab === t}
              className={cn(
                "rounded-lg py-2 text-[13px] font-semibold capitalize transition-colors",
                tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Amount — the one field, stated in AURA */}
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-border/70 px-4 py-3">
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/[^0-9.]/g, ""));
              setStakeExact(null);
            }}
            inputMode="decimal"
            placeholder="0"
            aria-label="Amount in AURA"
            className="num w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground/50"
          />
          <span className="shrink-0 text-sm font-medium text-muted-foreground">AURA</span>
        </div>

        {tab === "withdraw" && (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!sharesQuery.data || sharesQuery.data <= 0n}
              onClick={() => {
                // Exact receipt bigint — never a rounded display value.
                const held = sharesQuery.data ?? 0n;
                setStakeExact(held);
                setAmount((Number(held) / 1e18).toFixed(4));
              }}
              className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-foreground/90 transition-colors hover:bg-secondary/70 disabled:opacity-50"
            >
              Max
            </button>
          </div>
        )}

        <div className="mt-3 space-y-1.5 rounded-2xl bg-secondary/40 p-3 text-[13px]">
          <Row label="Handle aura" value={handle.aura.toFixed(1)} />
          {tab === "deposit" ? (
            <>
              <Row label="Deposit fee" value={`${(feeBps / 100).toFixed(2)}%`} />
              <Row label="You receive" value={`${formatCompact(net)} shares`} strong />
            </>
          ) : (
            <Row
              label="Wallet"
              value={
                auth.address
                  ? `${auth.address.slice(0, 6)}…${auth.address.slice(-4)}`
                  : "not connected"
              }
            />
          )}
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={amt <= 0 || pending !== null}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <TrendingUp className="h-4 w-4" />
          )}
          {pending ? "Confirming…" : tab === "deposit" ? "Deposit" : "Withdraw"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("num", strong ? "font-semibold text-foreground" : "text-foreground/90")}>
        {value}
      </span>
    </div>
  );
}

/** Graduation gate — trading prediction unlocks only at ≥ 100 Aura. */
export function GraduationGate({ handle }: { handle: HandleLink }) {
  const graduated = handle.aura >= 100;
  return (
    <div className="rounded-2xl border border-border/70 p-4 text-sm">
      {graduated ? (
        <div className="flex items-center gap-2 text-emerald-600">
          <TrendingUp className="h-4 w-4" />
          <span>
            <span className="font-semibold">@{handle.name}</span> is graduated — trading prediction
            is live.
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4" />
          <span>
            Trading prediction is locked.{" "}
            <span className="font-semibold text-foreground">@{handle.name}</span> needs{" "}
            <span className="font-semibold">{100 - handle.aura} more Aura</span> to graduate.
          </span>
        </div>
      )}
    </div>
  );
}
