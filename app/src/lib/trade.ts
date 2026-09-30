/**
 * Trade executor — every buy / sell / claim / limit order is a REAL contract
 * write signed by the Privy embedded wallet (USDC allowance handled first),
 * quoted against the live LMSR price for slippage guards. On confirmation the
 * market/position caches are invalidated so the UI re-reads the indexer.
 *
 * PRE-FLIGHT: before anything is signed the executor reads the on-chain state it
 * can check cheaply — wallet balance, share balance, window still open — and
 * refuses with a precise message instead of burning gas on a revert.
 */
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Address, Hash } from "viem";
import { useAuraAuth } from "./aura-auth";
import { useAuraContracts } from "./contracts";
import { CONTRACTS } from "./chain";
import { qk } from "@/queries/keys";

const E18 = 10n ** 18n;
/** 5% slippage guard — quote at the live price, accept a worse fill within 5%. */
const SLIP_NUM = 95n;
const SLIP_DEN = 100n;

/** Dollars (≤2 decimals) → 1e18 collateral units, exact. */
function toE18(usd: number): bigint {
  return BigInt(Math.max(0, Math.round(usd * 100))) * (E18 / 100n);
}

/** 1e18 units → "12.34" (K/M/B above 1,000) for error copy. */
function units(n: bigint): string {
  const v = Number(n) / 1e18;
  if (Math.abs(v) < 1_000) {
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

function shortHash(hash: Hash): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

/**
 * Friendly revert copy lives in `lib/revert-copy` so both this executor and
 * `lib/notify` share one table without an import cycle; re-exported here so
 * existing `from "@/lib/trade"` call sites keep working.
 */
import { explainRevert } from "./revert-copy";
export { explainRevert };

export type TradeTarget = {
  /** Per-window Oracle address (the window's on-chain identity). */
  oracle: string;
  /** Handle id — invalidates that market's caches. */
  handleId: string;
  /** Window id — invalidates chart / book / tape caches. */
  windowId: string;
};

export function useTradeExecutor() {
  const { api, address } = useAuraContracts();
  const { login } = useAuraAuth();
  const qc = useQueryClient();

  const invalidate = (t: TradeTarget) => {
    const addr = address?.toLowerCase() ?? "";
    void qc.invalidateQueries({ queryKey: qk.handles });
    void qc.invalidateQueries({ queryKey: qk.windows });
    void qc.invalidateQueries({ queryKey: qk.handleWindows(t.handleId) });
    void qc.invalidateQueries({ queryKey: qk.window(t.windowId) });
    void qc.invalidateQueries({ queryKey: qk.windowPoints(t.windowId) });
    void qc.invalidateQueries({ queryKey: qk.windowTrades(t.windowId) });
    void qc.invalidateQueries({ queryKey: qk.orderbook(t.windowId) });
    void qc.invalidateQueries({ queryKey: qk.stats });
    void qc.invalidateQueries({ queryKey: qk.leaderboard });
    if (addr) {
      void qc.invalidateQueries({ queryKey: qk.positions(addr) });
      void qc.invalidateQueries({ queryKey: qk.openOrders(addr) });
    }
  };

  /** false → a login prompt was opened (no wallet connected yet). */
  const requireWallet = (): boolean => {
    if (address) return true;
    void login();
    toast.info("Connect a wallet to trade");
    return false;
  };

  /**
   * Best-effort on-chain pre-flight. Returns false (with a message) when the
   * account provably can't pay / sell, true when it can or when the read itself
   * failed (the transaction then surfaces the revert).
   */
  const preflight = async (check: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await check();
    } catch {
      return true;
    }
  };

  const needUsdc = async (amount: bigint): Promise<boolean> =>
    preflight(async () => {
      const bal = (await api.readTokenBalance(CONTRACTS.usdc as Address)) as bigint;
      if (bal >= amount) return true;
      toast.error("Insufficient USDC", {
        description: `You have ${units(bal)} USDC — this needs ${units(amount)}.`,
      });
      return false;
    });

  const needShares = async (oracle: Address, outcome: number, shares: bigint): Promise<boolean> =>
    preflight(async () => {
      const held = await api.readOutcomeShares(oracle, BigInt(outcome));
      if (held >= shares) return true;
      toast.error("Not enough shares", {
        description: `You hold ${units(held)} of this outcome — selling ${units(shares)}.`,
      });
      return false;
    });

  const needOpen = async (oracle: Address): Promise<boolean> =>
    preflight(async () => {
      const open = await api.readWindowOpen(oracle);
      if (open) return true;
      toast.error("Window is closed", {
        description: "This market has ended — settle or claim instead.",
      });
      return false;
    });

  const run = async (
    target: TradeTarget,
    loading: string,
    success: string,
    describe: string,
    fn: () => Promise<Confirmed>,
  ): Promise<boolean> => {
    const id = toast.loading(loading, { description: "Confirm in your wallet…" });
    try {
      const { hash } = await fn();
      toast.success(success, { id, description: `${describe} · ${shortHash(hash)}` });
      invalidate(target);
      return true;
    } catch (e) {
      toast.error(explainRevert(e), { id, description: "Transaction not confirmed" });
      return false;
    }
  };

  type Confirmed = { hash: Hash };

  return {
    address,

    /** Market buy: `usd` USDC → shares of `outcome` at the live LMSR price. */
    async buy(t: TradeTarget, outcome: number, usd: number): Promise<boolean> {
      if (!requireWallet()) return false;
      const amount = toE18(usd);
      if (amount <= 0n) {
        toast.error("Enter an amount");
        return false;
      }
      const oracle = t.oracle as Address;
      if (!(await needOpen(oracle))) return false;
      if (!(await needUsdc(amount))) return false;
      return run(
        t,
        `Buying ${outcome}…`,
        "Trade confirmed",
        `${usd} USDC → outcome ${outcome}`,
        async () => {
          const mm = CONTRACTS.marketMaker as Address;
          await api.ensureUsdcAllowance(mm, amount);
          const price = (await api.readPrice(oracle, BigInt(outcome))) as bigint;
          if (price <= 0n || price >= E18) throw new Error("This outcome isn't trading");
          // Quote the shares the contract will actually mint for this budget: it
          // charges the EXACT LMSR cost (convex), so the spot-price estimate is
          // corrected the same way `buy` does. Without this the slippage guard
          // would be computed off a number the contract never delivers.
          const feeBps = (await api.readMarketFeeBps().catch(() => 0n)) as bigint;
          let delta = (amount * E18) / price;
          for (let i = 0; i < 4; i++) {
            const cost = (await api.readBuyCost(oracle, BigInt(outcome), delta)) as bigint;
            if (cost === 0n) break;
            const need = cost + (cost * feeBps) / 10_000n;
            if (need <= amount) break;
            delta = (delta * amount) / need;
          }
          const minShares = (delta * SLIP_NUM) / SLIP_DEN;
          return api.buy(oracle, BigInt(outcome), amount, minShares);
        },
      );
    },

    /** Cash out `shares` (1e18) of `outcome` at the live LMSR price. */
    async sell(t: TradeTarget, outcome: number, shares: bigint): Promise<boolean> {
      if (!requireWallet()) return false;
      if (shares <= 0n) {
        toast.error("Enter a share amount");
        return false;
      }
      const oracle = t.oracle as Address;
      if (!(await needOpen(oracle))) return false;
      if (!(await needShares(oracle, outcome, shares))) return false;
      // The window's own cash must cover the proceeds, or `sell` reverts
      // `LedgerShort`. Check it here so the user gets a clear message (and no
      // wasted gas) instead of a raw revert.
      const covered = await preflight(async () => {
        const proceeds = (await api.readSellProceeds(oracle, BigInt(outcome), shares)) as bigint;
        if (proceeds <= 0n) {
          toast.error("This size returns nothing", {
            description: "The live price makes this sale worthless — try a smaller size.",
          });
          return false;
        }
        const cash = await api.readWindowCash(oracle);
        if (proceeds > cash) {
          toast.error("Market can't cover this sale", {
            description: `The window holds ${units(cash)} USDC of cash — this sale pays ${units(proceeds)}. Try a smaller size.`,
          });
          return false;
        }
        return true;
      });
      if (!covered) return false;
      return run(
        t,
        "Selling shares…",
        "Sale confirmed",
        `${Number(shares) / 1e18} shares → outcome ${outcome}`,
        async () => {
          const proceeds = (await api.readSellProceeds(oracle, BigInt(outcome), shares)) as bigint;
          if (proceeds <= 0n) throw new Error("This size returns nothing at the live price");
          const minProceeds = (proceeds * SLIP_NUM) / SLIP_DEN;
          return api.sell(oracle, BigInt(outcome), shares, minProceeds);
        },
      );
    },

    /** Redeem winning shares after settlement. */
    async claim(t: TradeTarget, outcome: number): Promise<boolean> {
      if (!requireWallet()) return false;
      const oracle = t.oracle as Address;
      const ready = await preflight(async () => {
        // Claims only exist after settlement: a still-open window has no winner.
        const open = await api.readWindowOpen(oracle);
        if (open) {
          toast.info("Window is still trading", {
            description: "Claims unlock once it settles — you can sell instead.",
          });
          return false;
        }
        const held = await api.readOutcomeShares(oracle, BigInt(outcome));
        if (held > 0n) return true;
        toast.info("Nothing to claim", { description: "You hold no shares of this outcome." });
        return false;
      });
      if (!ready) return false;
      return run(t, "Claiming…", "Claim confirmed", `outcome ${outcome} winnings`, () =>
        api.claim(oracle, BigInt(outcome)),
      );
    },

    /**
     * Rest a limit order: side=true buys `sizeShares` at `priceUsd` (per share),
     * side=false sells `sizeShares`. Approvals are arranged first.
     */
    async placeOrder(
      t: TradeTarget,
      outcome: number,
      side: boolean,
      priceUsd: number,
      sizeShares: number,
      expiresAt = 0,
    ): Promise<boolean> {
      if (!requireWallet()) return false;
      const price = toE18(priceUsd);
      const size = toE18(sizeShares);
      if (price <= 0n || price >= E18 || size <= 0n) {
        toast.error("Price must be 1–99¢ and size above 0");
        return false;
      }
      if (expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000)) {
        toast.error("Expiry must be in the future");
        return false;
      }
      const oracle = t.oracle as Address;
      const notional = (size * price) / E18;
      if (!(await needOpen(oracle))) return false;
      if (side) {
        if (!(await needUsdc(notional))) return false;
      } else if (!(await needShares(oracle, outcome, size))) {
        return false;
      }
      return run(
        t,
        "Placing limit order…",
        "Order resting",
        `${side ? "Buy" : "Sell"} ${sizeShares} @ ${priceUsd}`,
        async () => {
          if (side) {
            await api.ensureUsdcAllowance(CONTRACTS.orderBook as Address, notional);
          } else {
            // Infinite approval on the book: one signature for every sell order.
            await api.approveOutcomeShares(oracle, BigInt(outcome), (1n << 256n) - 1n);
          }
          return api.placeOrder(
            oracle,
            BigInt(outcome),
            side,
            price,
            size,
            BigInt(Math.floor(expiresAt)),
          );
        },
      );
    },

    /** Cancel a resting order (escrow returns to the maker). */
    async cancelOrder(t: TradeTarget, orderId: string): Promise<boolean> {
      if (!requireWallet()) return false;
      return run(t, "Cancelling order…", "Order cancelled", orderId.slice(0, 10), () =>
        api.cancelOrder(t.oracle as Address, orderId as `0x${string}`),
      );
    },
  };
}
