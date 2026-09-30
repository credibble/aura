import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Droplets, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FeedLayout } from "@/components/social/FeedLayout";
import { FeedSearch, SidebarFooter } from "@/components/social/RightSidebar";
import { ActivityChart } from "@/components/aura/charts";
import { AmountInput } from "@/components/aura/AmountInput";
import { UsdcAmount, UsdcIcon } from "@/components/aura/UsdcIcon";
import { QueryError } from "@/components/QueryState";
import { Skeleton } from "@/components/ui/skeletons";
import { useAuraAuth } from "@/lib/aura-auth";
import { useAuraContracts } from "@/lib/contracts";
import { CONTRACTS } from "@/lib/chain";
import { formatCompact, formatUsd } from "@/lib/format";
import { explainRevert } from "@/lib/trade";
import { cn } from "@/lib/utils";
import { qk } from "@/queries/keys";
import { poolEventsOptions, poolSnapshotsOptions } from "@/queries/pool";

export const Route = createFileRoute("/pool")({
  head: () => ({
    meta: [
      { title: "Liquidity pool — Aura" },
      {
        name: "description",
        content: "Provide USDC to the auraLP vault and earn from every window traded on Aura.",
      },
    ],
  }),
  component: PoolPage,
});

const toUnits = (n: number) => BigInt(Math.round(n * 1e18));
const fromUnits = (n: bigint) => Number(n) / 1e18;
const e18 = (n: string) => Number(n) / 1e18;

const RANGES = [
  { id: "1D", spanMs: 86_400_000 },
  { id: "1W", spanMs: 7 * 86_400_000 },
  { id: "1M", spanMs: 30 * 86_400_000 },
  { id: "ALL", spanMs: Number.POSITIVE_INFINITY },
] as const;

function ago(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const KIND_LABEL = {
  RESERVED: "Reserved",
  PAID_OUT: "Paid out",
  UNRESERVED: "Released",
} as const;

/**
 * The auraLP vault's own page: depth and the reserve/idle split at the top, the
 * snapshot history as the hero chart, the vault's recent flows, and one quiet
 * deposit / withdraw panel. Figures are the contract's live values or the
 * subgraph's snapshots — never estimates.
 */
function PoolPage() {
  const { address, api } = useAuraContracts();
  const { login } = useAuraAuth();
  const qc = useQueryClient();

  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("1W");
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState<"deposit" | "withdraw" | null>(null);

  const snapshots = useQuery(poolSnapshotsOptions);
  const events = useQuery(poolEventsOptions);
  const stats = useQuery({
    queryKey: qk.pool("stats"),
    queryFn: () => api.readPoolStats(),
    enabled: !!CONTRACTS.pool,
    meta: { pollMs: 30_000 },
  });
  const shares = useQuery({
    queryKey: qk.pool("shares", address ?? ""),
    queryFn: () => api.readPoolShares(),
    enabled: !!address && !!CONTRACTS.pool,
  });

  const snaps = useMemo(() => snapshots.data ?? [], [snapshots.data]);
  const latest = snaps[snaps.length - 1];

  // Live contract values win; the newest snapshot fills the gap before the read.
  const assets = stats.data
    ? fromUnits(stats.data.totalAssets)
    : latest
      ? e18(latest.totalAssets)
      : 0;
  const idle = stats.data ? fromUnits(stats.data.idle) : latest ? e18(latest.idle) : 0;
  const reserved = stats.data
    ? fromUnits(stats.data.reserved)
    : latest
      ? e18(latest.totalReserved)
      : 0;
  const shareValue = stats.data
    ? Number(stats.data.valuePerToken) / 1e18
    : latest
      ? e18(latest.valuePerToken)
      : 0;

  const history = useMemo(() => {
    const cfg = RANGES.find((r) => r.id === range)!;
    const from = Number.isFinite(cfg.spanMs) ? Date.now() - cfg.spanMs : 0;
    const rows = snaps
      .filter((s) => Number(s.timestamp) * 1000 >= from)
      .map((s) => e18(s.totalAssets));
    // One point can't draw a line — repeat it so a fresh vault still renders.
    return rows.length > 1 ? rows : rows.length === 1 ? [rows[0]!, rows[0]!] : [];
  }, [snaps, range]);

  const up = history.length > 1 ? history[history.length - 1]! >= history[0]! : true;
  const amt = Number(amount) || 0;
  const s = stats.data;
  const previewShares =
    s && amt > 0 ? (toUnits(amt) * (s.totalSupply + 1_000n)) / (s.totalAssets + 1n) : 0n;
  const previewPayout =
    s && amt > 0 && s.totalSupply > 0n ? (toUnits(amt) * s.totalAssets) / s.totalSupply : 0n;
  const overIdle = tab === "withdraw" && s ? previewPayout > s.idle : false;

  const submit = async () => {
    if (!address) {
      void login();
      toast.info("Connect a wallet to provide liquidity");
      return;
    }
    const wei = toUnits(amt);
    if (wei <= 0n) {
      toast.error("Enter an amount");
      return;
    }
    try {
      // Pre-flight: paying from balance, or burning receipts you actually hold.
      if (tab === "deposit") {
        const bal = (await api.readTokenBalance(CONTRACTS.usdc as `0x${string}`)) as bigint;
        if (bal < wei) {
          toast.error("Insufficient USDC", {
            description: `You have ${formatUsd(fromUnits(bal))} USDC — this needs ${formatUsd(amt)}.`,
          });
          return;
        }
      } else {
        const held = await api.readPoolShares();
        if (held < wei) {
          toast.error("Not enough auraLP receipts", {
            description: `You hold ${fromUnits(held).toFixed(2)} — withdrawing ${formatCompact(amt)}.`,
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
        const approved = await api.ensureUsdcAllowance(CONTRACTS.pool as `0x${string}`, wei);
        if (approved)
          toast.info("USDC approved", { description: "The vault can pull your deposit." });
        const dep = await api.poolDeposit(wei);
        toast.success(`Deposited ${formatUsd(amt)} USDC`, {
          description: `confirmed ${dep.hash.slice(0, 10)}…`,
        });
      } else {
        const wd = await api.poolWithdraw(wei);
        toast.success("Withdrew from auraLP", {
          description: `confirmed ${wd.hash.slice(0, 10)}…`,
        });
      }
      setAmount("");
      void qc.invalidateQueries({ queryKey: ["pool"] });
    } catch (e) {
      toast.error("Transaction failed", { description: explainRevert(e) });
    } finally {
      setPending(null);
    }
  };

  return (
    <FeedLayout
      sidebar={
        <>
          <FeedSearch />
          <section className="rounded-2xl border border-border/70 bg-card p-4">
            <h2 className="text-sm font-semibold">How the vault works</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              Deposits mint auraLP receipts against the pool&apos;s assets. Every window traded
              reserves cash from the vault and pays winners from it — fees and losing premium stay
              pooled, lifting the value of each receipt.
            </p>
          </section>
          <div className="rounded-2xl border border-border/70 bg-card p-4">
            <h2 className="text-sm font-semibold">Your position</h2>
            <dl className="mt-2 space-y-1.5 text-[13px]">
              <Row
                label="Receipts"
                value={shares.data !== undefined ? fromUnits(shares.data).toFixed(2) : "—"}
              />
              <Row
                label="Worth"
                value={
                  shares.data !== undefined ? (
                    <UsdcAmount value={formatUsd(fromUnits(shares.data) * shareValue)} />
                  ) : (
                    "—"
                  )
                }
              />
            </dl>
            {!address && (
              <button
                type="button"
                onClick={() => void login()}
                className="mt-3 h-9 w-full rounded-xl border border-border/70 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                Connect wallet
              </button>
            )}
          </div>
          <SidebarFooter />
        </>
      }
    >
      <div className="px-4 pt-8 pb-4 sm:px-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Droplets className="h-4 w-4" /> auraLP
        </div>
        <h1 className="mt-1 text-[28px] font-bold tracking-tight sm:text-3xl">Liquidity pool</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Provide USDC to back every window and earn from the flow. Withdraw pro-rata any time.
        </p>
      </div>

      {/* Depth */}
      {snapshots.isError && (
        <div className="px-4 pt-4 sm:px-6">
          <QueryError what="the pool" onRetry={() => void snapshots.refetch()} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-4 sm:px-6">
        <Stat
          label="Pool depth"
          value={<UsdcAmount value={formatUsd(assets)} size={16} />}
          strong
        />
        <Stat label="Idle" value={<UsdcAmount value={formatUsd(idle)} />} />
        <Stat label="Reserved" value={<UsdcAmount value={formatUsd(reserved)} />} />
        <Stat label="auraLP value" value={`${shareValue.toFixed(4)}`} />
      </div>

      {/* Chart + deposit/withdraw, side by side */}
      <div className="grid gap-4 px-4 pt-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs text-muted-foreground">Pooled USDC</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-2xl font-bold tracking-tight">
                <UsdcIcon size={20} />
                <span className="num">{formatUsd(assets)}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRange(r.id)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                    range === r.id
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r.id}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            {history.length > 0 ? (
              <ActivityChart
                data={history}
                color={up ? "hsl(var(--up))" : "hsl(var(--down))"}
                height={240}
                padX={0}
                strokeWidth={1.75}
              />
            ) : (
              <div className="flex h-[240px] items-center justify-center text-[13px] text-muted-foreground">
                {snapshots.isPending ? "Loading pool history…" : "No pool activity yet."}              </div>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Snapshots are taken on every vault event — deposits, withdrawals, reserves and payouts.
          </p>
        </section>

        {/* Deposit / withdraw — one segmented control, one amount, one action */}
        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <div
            role="group"
            aria-label="Pool action"
            className="grid grid-cols-2 gap-1 rounded-xl bg-secondary/50 p-1"
          >
            {(["deposit", "withdraw"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
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

          <div className="mt-5 flex items-center justify-center gap-2 rounded-2xl border border-border/70 px-4 py-5">
            <UsdcIcon size={26} />
            <AmountInput
              value={amount}
              onChange={setAmount}
              placeholder="0"
              textClassName="num text-5xl font-semibold"
              ariaLabel={tab === "deposit" ? "Amount in USDC" : "auraLP receipts"}
            />
          </div>

          <div className="mt-4 space-y-1.5 rounded-2xl bg-secondary/40 p-3 text-[13px]">
            {tab === "deposit" ? (
              <>
                <Row label="You receive" value={`${fromUnits(previewShares).toFixed(4)} auraLP`} />
                <Row
                  label="Share of pool"
                  value={
                    s && s.totalSupply + previewShares > 0n
                      ? share(previewShares, s.totalSupply + previewShares)
                      : "—"
                  }
                />
              </>
            ) : (
              <>
                <Row label="You receive" value={formatUsd(fromUnits(previewPayout))} />
                <Row label="Available (idle)" value={s ? formatUsd(fromUnits(s.idle)) : "—"} />
              </>
            )}
          </div>

          {overIdle && (
            <p className="mt-2 text-[12px] text-down">
              More than the idle cash right now — reserves hold{" "}
              {s ? formatUsd(fromUnits(s.reserved)) : ""}.
            </p>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={amt <= 0 || pending !== null || overIdle}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Droplets className="h-4 w-4" />
            )}
            {pending ? "Confirming…" : tab === "deposit" ? "Deposit USDC" : "Withdraw"}
          </button>
        </section>
      </div>

      {/* Recent flows — a plain table, no card wrapper */}
      <section className="mt-8 px-4 pb-10 sm:px-6">
        <h2 className="text-sm font-semibold">Recent activity</h2>
        <div className="overflow-x-auto">
          <table className="mt-3 w-full min-w-[560px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-border/70 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-semibold">Type</th>
              <th className="py-2 pr-3 font-semibold">Window</th>
              <th className="py-2 pr-3 text-right font-semibold">Amount</th>
              <th className="py-2 text-right font-semibold">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {(events.data ?? []).slice(0, 12).map((e) => {
              const inflow = e.kind === "RESERVED";
              return (
                <tr key={e.id} className="transition-colors hover:bg-secondary/25">
                  <td className="py-3 pr-3">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      {inflow ? (
                        <ArrowUpRight className="h-3.5 w-3.5 text-up" />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5 text-down" />
                      )}
                      {KIND_LABEL[e.kind]}
                    </span>
                  </td>
                  <td className="num py-3 pr-3 text-muted-foreground">
                    {e.oracle ? `${e.oracle.slice(0, 6)}…${e.oracle.slice(-4)}` : "—"}
                  </td>
                  <td className="num py-3 pr-3 text-right font-semibold">
                    <UsdcAmount value={formatUsd(e18(e.amount))} size={12} />
                  </td>
                  <td className="py-3 text-right text-muted-foreground">
                    {ago(Number(e.timestamp) * 1000)}
                  </td>
                </tr>
              );
            })}
            {!events.isPending && (events.data ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted-foreground">
                  No vault activity yet.
                </td>
              </tr>
            )}
            {events.isPending && (
              <tr aria-hidden="true">
                <td colSpan={4} className="py-3">
                  <Skeleton className="h-4 w-full" />
                </td>
              </tr>
            )}
          </tbody>
          </table>
        </div>
      </section>
    </FeedLayout>
  );
}

function share(minted: bigint, supply: bigint): string {
  if (supply === 0n) return "—";
  const pct = (Number(minted) / Number(supply)) * 100;
  return `${pct.toFixed(pct < 1 ? 2 : 1)}%`;
}

function Stat({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card px-3.5 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("num mt-0.5", strong ? "text-xl font-bold" : "text-sm font-semibold")}>
        {value}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="num font-medium text-foreground">{value}</span>
    </div>
  );
}
