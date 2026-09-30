import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import type { Address } from "viem";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuraAuth } from "@/lib/aura-auth";
import { useAuraContracts } from "@/lib/contracts";
import { formatUsd } from "@/lib/format";
import { UsdcAmount } from "@/components/aura/UsdcIcon";
import type { HandleLink } from "@/lib/portfolio";
import { qk } from "@/queries/keys";

/**
 * Creator revenue for the active (owned) handle: the USDC sitting in the
 * Handle contract (`usdc.balanceOf(handle)`), claimable with one click —
 * `Handle.claim()` is owner-only and sweeps the full balance to the wallet.
 * Owner-only by construction: the /me handle list is subgraph owner-filtered.
 */
export function RevenueCard({ handle }: { handle: HandleLink }) {
  const { api, address } = useAuraContracts();
  const { login } = useAuraAuth();
  const qc = useQueryClient();

  const revenue = useQuery({
    queryKey: qk.handleRevenue(handle.contract),
    queryFn: () => api.readHandleRevenue(handle.contract as Address),
    enabled: Boolean(handle.contract && address),
    staleTime: 15_000,
  });

  const claim = useMutation({
    mutationFn: () => api.handleClaim(handle.contract as Address),
    onSuccess: () => {
      toast.success("Revenue claimed", { description: "USDC swept to your wallet." });
      void qc.invalidateQueries({ queryKey: qk.handleRevenue(handle.contract) });
      void qc.invalidateQueries({ queryKey: qk.handles });
    },
    onError: (e: Error) => notifyError(e, "Claim"),
  });

  const amount = revenue.data ?? 0n;
  const claimable = amount > 0n;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
            <Coins className="h-4 w-4" />
          </span>
          Creator revenue
        </CardTitle>
        <CardDescription>
          USDC trading fees accrued by this handle. Claim sweeps the full balance to your wallet
          (owner only).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="num text-2xl font-bold tracking-tight text-foreground">
            {!address
              ? "Sign in"
              : revenue.isPending
                ? "…"
                : revenue.isError
                  ? "—"
                  : <UsdcAmount value={formatUsd(Number(amount) / 1e18)} size={18} />}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            claimable on @{handle.name}
          </p>
        </div>
        <Button
          type="button"
          disabled={!claimable || claim.isPending}
          onClick={() => {
            if (!address) {
              void login();
              toast.info("Connect a wallet to claim revenue");
              return;
            }
            claim.mutate();
          }}
          className="shrink-0"
        >
          {claim.isPending ? "Claiming…" : "Claim"}
        </Button>
      </CardContent>
    </Card>
  );
}
