import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, Droplets, LogIn, Wallet } from "lucide-react";
import { FeedLayout } from "@/components/social/FeedLayout";
import { QueryError } from "@/components/QueryState";
import { Skeleton } from "@/components/ui/skeletons";
import { FeedSearch, SidebarFooter } from "@/components/social/RightSidebar";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { SourcesPanel } from "@/components/aura/SourcesPanel";
import { StakeButton } from "@/components/aura/StakeButton";
import { ActivityChart } from "@/components/aura/charts";
import { StakePopup } from "@/components/portfolio/StakePopup";
import { ConnectionsSection } from "@/components/portfolio/ConnectionsRow";
import { EditProfileDialog } from "@/components/portfolio/EditProfileDialog";
import { findHandle, handleSlug } from "@/lib/handle-id";
import { formatCompact, formatIndex, formatPct } from "@/lib/format";
import { GRADUATION_AURA } from "@/lib/portfolio";
import { useAuraAuth } from "@/lib/aura-auth";
import { useAuraContracts } from "@/lib/contracts";
import { useHandles, useLoadHandles } from "@/lib/handle-store";
import { handlesQueryOptions } from "@/queries/handles";
import { stakeOptions, stakeSnapshotsOptions } from "@/queries/stake";
import { positionsOptions } from "@/queries/user";
import { qk } from "@/queries/keys";

export const Route = createFileRoute("/me")({
  head: () => ({ meta: [{ title: "Me — Aura" }] }),
  component: MePage,
});

/**
 * Your account: the handle you act as, its aura, the AURA staked behind it, your
 * trading positions, and the sources it publishes from. Staking lives here and
 * on every handle page — it is the protocol's core signal.
 */
function MePage() {
  const { address, api } = useAuraContracts();
  const { login } = useAuraAuth();
  useLoadHandles(address ?? null);
  const { handles, activeId } = useHandles();
  const active = handles.find((h) => h.id === activeId) ?? handles[0];

  const vault =
    active?.stake && active.stake !== "0x" ? (active.stake as `0x${string}`) : undefined;
  const stakeEntity = useQuery(stakeOptions(vault));
  const stakeHistory = useQuery(stakeSnapshotsOptions(vault));
  const stakeStats = useQuery({
    queryKey: qk.stake("stats", vault ?? ""),
    queryFn: () => api.readStakeStats(vault!),
    enabled: !!vault,
  });
  const stakeShares = useQuery({
    queryKey: qk.stake("shares", vault ?? "", address ?? ""),
    queryFn: () => api.readStakeShares(vault!, address ?? undefined),
    enabled: !!vault && !!address,
  });
  const stakeEarned = useQuery({
    queryKey: qk.stake("earned", vault ?? "", address ?? ""),
    queryFn: () => api.readStakeEarned(vault!, address ?? undefined),
    enabled: !!vault && !!address,
  });
  const positions = useQuery(positionsOptions(address ?? undefined));
  const openPositions = (positions.data ?? []).length;

  // The account page had neither a loading nor an error state: a failed handles
  // query rendered the "No handle yet" state for someone who HAS a handle.
  const handlesQuery = useQuery(handlesQueryOptions);
  const subgraphHandles = handlesQuery.data;
  const record = useMemo(
    () => (active ? findHandle(subgraphHandles, active.id) : undefined),
    [subgraphHandles, active],
  );

  if (handlesQuery.isPending) {
    return (
      <FeedLayout sidebar={<FeedSearch />}>
        <div className="space-y-4 px-4 pt-6 sm:px-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </FeedLayout>
    );
  }

  if (handlesQuery.isError) {
    return (
      <FeedLayout sidebar={<FeedSearch />}>
        <div className="px-4 pt-6 sm:px-6">
          <QueryError what="your handle" onRetry={() => void handlesQuery.refetch()} />
        </div>
      </FeedLayout>
    );
  }

  if (!address) {
    return (
      <FeedLayout sidebar={<FeedSearch />}>
        <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-4 text-center">
          <Wallet className="h-7 w-7 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Connect a wallet</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Your handle, its stake and your positions live on-chain — sign in to see them.
          </p>
          <button
            type="button"
            onClick={() => void login()}
            className="mt-1 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110"
          >
            <LogIn className="h-4 w-4" /> Connect wallet
          </button>
        </div>
      </FeedLayout>
    );
  }

  if (!active) {
    return (
      <FeedLayout sidebar={<FeedSearch />}>
        <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-4 text-center">
          <h1 className="text-xl font-semibold">No handle yet</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Claim a handle to trade, publish sources and receive stake.
          </p>
        </div>
      </FeedLayout>
    );
  }

  const slug = handleSlug(active);
  const staked = stakeEntity.data
    ? Number(stakeEntity.data.totalAssets) / 1e18
    : stakeStats.data
      ? Number(stakeStats.data.totalAssets) / 1e18
      : undefined;
  const myShares = stakeShares.data !== undefined ? Number(stakeShares.data) / 1e18 : undefined;
  const myValue = stakeEarned.data !== undefined ? Number(stakeEarned.data) / 1e18 : undefined;
  const share =
    staked && myValue && staked > 0 ? Math.min(100, (myValue / staked) * 100) : undefined;

  const stakeHandle = {
    id: active.id,
    name: active.name,
    symbol: active.symbol,
    aura: active.aura,
    sources: active.sources ?? [],
    stake: active.stake,
    pool: "",
    contract: active.contract ?? "0x",
  };

  return (
    <FeedLayout
      sidebar={
        <>
          <FeedSearch />
          {(active.sources?.length ?? 0) > 0 && (
            <SourcesPanel sources={active.sources} label={`@${slug}`} />
          )}
          <SidebarFooter />
        </>
      }
    >
      {/* Identity */}
      <div className="flex flex-wrap items-center gap-4 px-4 pt-8 pb-5 sm:px-6">
        <AssetAvatar
          asset={{
            id: active.id,
            symbol: active.symbol,
            color: "hsl(var(--primary))",
            name: active.name,
          }}
          size={64}
        />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-2xl font-bold tracking-tight">{active.name}</h1>
            {record?.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-link" />}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/$id" params={{ id: slug }} className="hover:underline">
              @{slug}
            </Link>
            <span>·</span>
            <span>
              {record?.graduated
                ? "Graduated"
                : `${Math.max(0, GRADUATION_AURA - active.aura)} aura to graduate`}
            </span>
          </div>
        </div>
        <Link
          to="/$id"
          params={{ id: slug }}
          className="rounded-full border border-border/70 px-4 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          Open market
        </Link>
        <EditProfileDialog handle={active} />
      </div>

      {/* Numbers */}
      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 px-4 sm:grid-cols-4 sm:px-6">
        <Stat
          label="Aura"
          value={formatIndex(active.aura)}
          hint={record ? formatPct(Number(record.auraDelta) / 100) : undefined}
        />
        <Stat
          label="Staked on you"
          value={
            staked !== undefined
              ? `${formatCompact(staked)}`
              : "—"
          }
          suffix="AURA"
        />
        <Stat
          label="Your stake"
          value={
            myValue !== undefined
              ? `${formatCompact(myValue)}`
              : "—"
          }
          suffix="AURA"
          hint={share !== undefined ? `${share.toFixed(1)}% of vault` : undefined}
        />
        <Stat
          label="Receipts"
          value={
            myShares !== undefined
              ? formatCompact(myShares)
              : "—"
          }
        />
      </dl>

      {/* The core action */}
      <div className="mt-6 flex flex-wrap items-center gap-3 px-4 sm:px-6">
        {vault ? (
          <StakePopup handle={stakeHandle} trigger={<StakeButton />} />
        ) : (
          <span className="text-[13px] text-muted-foreground">
            This handle has no stake vault deployed yet.
          </span>
        )}
        <Link
          to="/portfolio"
          className="flex items-center gap-1.5 rounded-full border border-border/70 px-4 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Wallet className="h-4 w-4" /> {openPositions} open position
          {openPositions === 1 ? "" : "s"}
        </Link>
        <Link
          to="/pool"
          className="flex items-center gap-1.5 rounded-full border border-border/70 px-4 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Droplets className="h-4 w-4" /> Provide liquidity
        </Link>
      </div>

      {/* Stake history — the vault's own snapshots */}
      {(stakeHistory.data?.length ?? 0) > 1 && (
        <section className="mt-8 px-4 sm:px-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Stake history</h2>
            <span className="num text-[13px] text-muted-foreground">
              {staked !== undefined
                ? `${formatCompact(staked)} AURA`
                : ""}
            </span>
          </div>
          <div className="mt-2">
            <ActivityChart
              data={(stakeHistory.data ?? []).map((s) => Number(s.totalAssets) / 1e18)}
              color="hsl(var(--primary))"
              height={140}
              padX={0}
              showDot={false}
              strokeWidth={1.75}
            />
          </div>
        </section>
      )}

      {/* Connections — one quiet popover per platform */}
      <div className="mt-8 px-4 pb-10 sm:px-6">
        <ConnectionsSection handle={active} connection={null} />
      </div>

      {/* Activity history from the subgraph */}
      <section className="mt-2 px-4 pb-10 sm:px-6">
        <h2 className="text-sm font-semibold">Aura history</h2>
        <div className="mt-2 divide-y divide-border/60">
          {(record?.auraHistory ?? []).slice(0, 8).map((p) => (
            <div key={p.timestamp} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-relaxed text-foreground/90">
                  {p.summary ?? "Aura index updated from this handle's live sources."}
                </p>
              </div>
              <span className="num shrink-0 text-sm font-semibold">
                {formatIndex(Number(p.aura) / 100)}
              </span>
            </div>
          ))}
          {(record?.auraHistory?.length ?? 0) === 0 && (
            <p className="py-6 text-[13px] text-muted-foreground">No aura updates recorded yet.</p>
          )}
        </div>
      </section>
    </FeedLayout>
  );
}

function Stat({
  label,
  value,
  suffix,
  hint,
}: {
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="num mt-1 text-xl font-bold">
        {value}
        {suffix && (
          <span className="ml-1 text-[11px] font-medium text-muted-foreground">{suffix}</span>
        )}
      </dd>
      {hint && <div className="num mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
