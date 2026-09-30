import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { AuraText } from "@/components/aura/AuraTerm";
import { Avatar } from "@/components/Avatar";
import { cents, pctLabel } from "@/components/aura/pm";
import { AmountInput } from "@/components/aura/AmountInput";
import { UsdcIcon } from "@/components/aura/UsdcIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Address } from "viem";
import { toast } from "sonner";
import type { Market } from "@/lib/aura-markets";
import { useTradeExecutor, explainRevert } from "@/lib/trade";
import { useAuraContracts } from "@/lib/contracts";
import { CONTRACTS } from "@/lib/chain";
import { positionsOptions } from "@/queries/user";
import { cn } from "@/lib/utils";

type Side = "buy" | "sell";
type Mode = "tap" | "market" | "limit";

const QUICK = [1, 5, 10, 100];
const TAP_STEPS = [5, 25, 100];
/** 1-Tap sells exit the position — the unit is shares, so there is no dollar chip. */
const TAP_SELL_LABEL = "Sell position";

/** Dollars/shares text → 1e18 base units (≤6 decimals of precision). */
function toE18Units(n: number): bigint {
  return BigInt(Math.max(0, Math.round(n * 1e6))) * 1_000_000_000_000n;
}

const toUnits = (n: number): bigint => BigInt(Math.max(0, Math.round(n * 1e6))) * 1_000_000_000_000n;

/**
 * Buy/Sell ticket bound to the real contracts. Quiet by design: one segmented
 * outcome control, one big amount, one action — everything else is a chip or a
 * dropdown so the panel never turns into a form.
 */
export function TradeTicket({ market }: { market: Market }) {
  const win = market.window;
  const { address, api } = useAuraContracts();
  const exec = useTradeExecutor();

  const [side, setSide] = useState<Side>("buy");
  const [mode, setMode] = useState<Mode>("market");
  const [picked, setPicked] = useState(0);
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [sharesIn, setSharesIn] = useState("");
  const [pending, setPending] = useState(false);

  const positions = useQuery(positionsOptions(address ?? undefined));
  // Collateral balance — drives the faucet hint below (testnet MockUSDC).
  const balance = useQuery({
    queryKey: ["usdc-balance", address],
    queryFn: () => api.readTokenBalance(CONTRACTS.usdc as Address) as Promise<bigint>,
    enabled: Boolean(address),
    staleTime: 5_000,
  });
  const [minting, setMinting] = useState(false);
  const held = useMemo(() => {
    if (!address) return 0n;
    let shares = 0n;
    for (const t of positions.data ?? []) {
      if (t.window.id !== win.id || t.outcome !== picked) continue;
      const s = BigInt(t.shares);
      if (t.kind === "BUY") shares += s;
      else shares -= s;
    }
    return shares < 0n ? 0n : shares;
  }, [positions.data, address, win.id, picked]);
  const heldNum = Number(held) / 1e18;

  /** Public MockUSDC faucet — 1,000 test dollars, one confirmed tx. */
  const getTestUsdc = async (): Promise<void> => {
    setMinting(true);
    const id = toast.loading("Minting test USDC…", { description: "Confirm in your wallet…" });
    try {
      await api.mintUsdc(1_000n * 10n ** 18n);
      toast.success("1,000 test USDC added", { id });
      await balance.refetch();
    } catch (error) {
      toast.error(explainRevert(error), { id, description: "Transaction not confirmed" });
    } finally {
      setMinting(false);
    }
  };

  const outcome = market.outcomes[picked] ?? market.outcomes[0]!;
  const priceCents = outcome.pct;
  const priceUsd = priceCents / 100;

  const now = Date.now();
  const live = !market.settled && market.windowEnd > now;
  const awaitingSettle = !market.settled && market.windowEnd <= now;

  const estShares = useMemo(() => {
    const n = Number(amount) || 0;
    return priceUsd > 0 ? n / priceUsd : 0;
  }, [amount, priceUsd]);

  // Exact share quote — the contract charges the convex LMSR cost, so the linear
  // estimate over-states what the budget buys. Mirrors `buy`'s correction loop
  // against the contract's own `buyCost`.
  const quote = useQuery({
    queryKey: ["buy-quote", win.oracle, picked, amount],
    enabled: (Number(amount) || 0) > 0,
    staleTime: 5_000,
    queryFn: async (): Promise<number> => {
      const oracle = win.oracle as `0x${string}`;
      const budget = toUnits(Number(amount));
      const price = (await api.readPrice(oracle, BigInt(picked))) as bigint;
      if (price <= 0n || price >= 10n ** 18n) return 0;
      const feeBps = (await api.readMarketFeeBps().catch(() => 0n)) as bigint;
      let delta = (budget * 10n ** 18n) / price;
      for (let i = 0; i < 4; i++) {
        const cost = (await api.readBuyCost(oracle, BigInt(picked), delta)) as bigint;
        if (cost === 0n) break;
        const need = cost + (cost * feeBps) / 10_000n;
        if (need <= budget) break;
        delta = (delta * budget) / need;
      }
      return Number(delta) / 1e18;
    },
  });
  const estimatedShares = quote.data ?? estShares;

  const limitCents = limitPrice ? Number(limitPrice) : priceCents;
  const limitShares = useMemo(() => {
    const n = Number(amount) || 0;
    const p = (limitCents || 0) / 100;
    return p > 0 ? n / p : 0;
  }, [amount, limitCents]);

  const target = { oracle: win.oracle, handleId: market.handleId, windowId: win.id };

  const submit = async () => {
    setPending(true);
    try {
      if (mode === "tap") {
        // 1-Tap is one action either way. Buying takes a fixed dollar chip;
        // selling exits the position, so the size is the held shares (1e18,
        // exactly what `exec.sell` takes) — the tap branch previously bought
        // even when the side was sell.
        if (side === "sell") {
          if (held <= 0n) return;
          await exec.sell(target, picked, held);
          return;
        }
        const usd = Number(amount) || TAP_STEPS[0]!;
        await exec.buy(target, picked, usd);
        return;
      }
      if (side === "buy") {
        const usd = Number(amount) || 0;
        if (usd <= 0) return;
        if (mode === "limit")
          await exec.placeOrder(target, picked, true, limitCents / 100, limitShares);
        else await exec.buy(target, picked, usd);
      } else {
        const shares = Number(sharesIn) || 0;
        if (shares <= 0) return;
        if (mode === "limit")
          await exec.placeOrder(target, picked, false, limitCents / 100, shares);
        else await exec.sell(target, picked, toE18Units(shares));
      }
    } finally {
      setPending(false);
    }
  };

  const claimable = market.settled && picked === market.winningOutcome && heldNum > 0;
  const buttonDisabled =
    !live ||
    (side === "buy" && (Number(amount) || 0) <= 0 && mode !== "tap") ||
    (side === "sell" && (Number(sharesIn) || 0) <= 0 && mode !== "tap") ||
    (side === "sell" && heldNum <= 0 && mode !== "tap");

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      {/* Handle + live outcome. The market IS the handle, and a bare "YES"/"NO"
          label has no photo of its own — so the ticket shows the handle's. */}
      <div className="flex items-start gap-3">
        <Avatar
          seed={market.handleId}
          image={market.image}
          metadata={market.metadata}
          imageFit={market.imageFit}
          size={36}
          alt={outcome.label}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="line-clamp-2 text-[14px] font-medium">
            <AuraText text={market.question} />
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {outcome.label} · {pctLabel(priceCents)}
          </div>
        </div>
        <div className="num shrink-0 text-right text-lg font-bold">{cents(priceCents)}</div>
      </div>

      {market.settled ? (
        <div className="mt-4 rounded-2xl bg-secondary/40 p-3.5 text-[13px]">
          <div className="font-semibold">
            Settled — {market.outcomes[market.winningOutcome ?? 0]?.label ?? "?"} won
          </div>
          {claimable ? (
            <>
              <div className="num mt-1 text-muted-foreground">
                {heldNum.toFixed(2)} winning shares · ${heldNum.toFixed(2)} payout
              </div>
              <button
                type="button"
                onClick={() => void exec.claim(target, picked)}
                className="mt-3 h-11 w-full rounded-xl bg-link text-sm font-semibold text-white transition-all hover:brightness-110"
              >
                Claim winnings
              </button>
            </>
          ) : (
            <p className="mt-1 text-muted-foreground">
              {!address
                ? "Connect to see your holdings."
                : heldNum > 0
                  ? "This outcome did not win — its shares are void."
                  : "No position on this outcome."}
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Outcome — segmented, tinted, no blocks of color */}
          <div
            role="group"
            aria-label="Outcome"
            className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-secondary/50 p-1"
          >
            {market.outcomes.map((o, i) => {
              const on = picked === i;
              const positive = i === 0;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setPicked(i)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-lg py-2 text-[13px] font-semibold transition-colors",
                    on
                      ? positive
                        ? "bg-up/15 text-up"
                        : "bg-down/15 text-down"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label} <span className="num opacity-70">{cents(o.pct)}</span>
                </button>
              );
            })}
          </div>

          {/* Buy / sell + order type */}
          <div className="mt-4 flex items-center justify-between">
            <div role="group" aria-label="Side" className="flex gap-3">
              {(["buy", "sell"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  aria-pressed={side === s}
                  className={cn(
                    "text-[13px] font-semibold capitalize transition-colors",
                    side === s ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Order type: ${mode === "tap" ? "1-Tap" : mode === "market" ? "Market" : "Limit"}`}
                  className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {mode === "tap" ? "1-Tap" : mode === "market" ? "Market" : "Limit"}
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setMode("tap")}>1-Tap</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMode("market")}>Market</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMode("limit")}>Limit</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* One-tap buy - chip steps */}
          {mode === "tap" ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {TAP_STEPS.map((step) => {
                const winUsd = priceUsd > 0 ? step / priceUsd - step : 0;
                return (
                  <button
                    key={step}
                    type="button"
                    disabled={!live}
                    onClick={() => void exec.buy(target, picked, step)}
                    className="rounded-xl border border-border/70 py-2.5 transition-colors hover:bg-secondary/50 disabled:opacity-50"
                  >
                    <div className="num text-base font-semibold">{step}</div>
                    <div className="num text-[11px] text-up">win {winUsd.toFixed(0)}</div>
                  </button>
                );
              })}
            </div>
          ) : side === "buy" ? (
            <>
              {/* Amount — one big number */}
              {/* Amount — one big number that grows with its digits */}
              <div className="mt-3 flex items-center justify-center gap-2">
                <UsdcIcon size={22} />
                <AmountInput
                  value={amount}
                  onChange={setAmount}
                  placeholder="0"
                  textClassName="num text-4xl font-semibold"
                  ariaLabel="Amount in USDC"
                />
              </div>
              <div className="num mt-1 text-center text-[11px] text-muted-foreground">
                ≈ {estimatedShares.toFixed(2)} shares @ {cents(priceCents)}
              </div>
              <div className="mt-3 flex justify-center gap-1.5">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setAmount(String((Number(amount) || 0) + q))}
                    className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-foreground/90 hover:bg-secondary/70"
                  >
                    +{q}
                  </button>
                ))}
              </div>
              {/* Testnet collateral is a public MockUSDC — offer the faucet the
                  moment the wallet can't cover the ticket, instead of letting
                  the trade revert on transfer. */}
              {address && (balance.data === undefined || Number(balance.data) < 1e18) && (
                <button
                  type="button"
                  disabled={minting}
                  onClick={() => void getTestUsdc()}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border border-dashed border-border/70 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {minting ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <UsdcIcon size={12} />
                  )}
                  Get 1,000 test USDC
                </button>
              )}
              {mode === "limit" && (
                <div className="mt-3 flex items-center justify-between rounded-xl border border-border/70 px-3 py-2">
                  <span className="text-[13px] text-muted-foreground">Limit price</span>
                  <div className="flex items-baseline gap-0.5">
                    <input
                      value={limitPrice}
                      onChange={(e) => setLimitPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder={String(priceCents)}
                      aria-label="Limit price in cents"
                      inputMode="decimal"
                      className="num w-14 bg-transparent text-right text-sm font-semibold outline-none placeholder:text-muted-foreground/50"
                    />
                    <span className="num text-xs text-muted-foreground">¢</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mt-3 flex items-center justify-center gap-2">
                <AmountInput
                  value={sharesIn}
                  onChange={setSharesIn}
                  placeholder="0"
                  textClassName="num text-4xl font-semibold"
                  ariaLabel="Shares to sell"
                />
                <span className="text-sm text-muted-foreground">shares</span>
              </div>
              <div className="num mt-1 text-center text-[11px] text-muted-foreground">
                {address
                  ? `you hold ${heldNum.toFixed(4)} · ≈ $${((Number(sharesIn) || 0) * priceUsd).toFixed(2)}`
                  : "connect to see your holdings"}
              </div>
              <div className="mt-3 flex justify-center gap-1.5">
                {[25, 50, 75, 100].map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={heldNum <= 0}
                    onClick={() => setSharesIn(((heldNum * q) / 100).toFixed(4))}
                    className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-foreground/90 hover:bg-secondary/70 disabled:opacity-50"
                  >
                    {q === 100 ? "Max" : `${q}%`}
                  </button>
                ))}
              </div>
            </>
          )}

          {awaitingSettle ? (
            <div className="mt-4 rounded-xl bg-secondary/40 px-3 py-3 text-center text-[13px] text-muted-foreground">
              Window closed — awaiting settlement.
            </div>
          ) : (
            mode !== "tap" && (
              <button
                type="button"
                disabled={buttonDisabled || pending}
                onClick={() => void submit()}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                {side === "buy"
                  ? mode === "limit"
                    ? "Place limit order"
                    : "Trade"
                  : mode === "limit"
                    ? "Place sell order"
                    : "Sell"}
              </button>
            )
          )}

          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Settles on Monad · trading means you accept the{" "}
            <span className="underline underline-offset-2">Terms of Use</span>.
          </p>
        </>
      )}
    </div>
  );
}
