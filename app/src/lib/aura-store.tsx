import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { handlesQueryOptions, toLiveAsset } from "@/queries/handles";
import type { AuraState, FeedEvent, LiveAsset } from "./aura-data";

// ----------------------------------------------------------------------------
// Live state provider — assets from the indexer (per-handle aura + history),
// live activity feed from the newest posts. No local simulation/tick.
// ----------------------------------------------------------------------------

const AuraContext = createContext<AuraState | null>(null);

export function AuraProvider({ children }: { children: ReactNode }) {
  const { data: handles } = useQuery(handlesQueryOptions);

  const assets = useMemo<LiveAsset[]>(() => (handles ?? []).map(toLiveAsset), [handles]);

  // No backend feed: the app's surfaces are the indexer's handles + windows.
  const feed = useMemo<FeedEvent[]>(() => [], []);

  const state = useMemo<AuraState>(() => ({ assets, feed }), [assets, feed]);

  return <AuraContext.Provider value={state}>{children}</AuraContext.Provider>;
}

export function useAura(): AuraState {
  const ctx = useContext(AuraContext);
  if (!ctx) throw new Error("useAura must be used within an AuraProvider");
  return ctx;
}

/** Returns a single asset by id (live values). */
export function useAsset(id: string): LiveAsset | undefined {
  const { assets } = useAura();
  return useMemo(() => assets.find((a) => a.id === id), [assets, id]);
}

export function useAssetsByCategory(category: string): LiveAsset[] {
  const { assets } = useAura();
  return useMemo(
    () => assets.filter((a) => a.categories.some((c) => c === category)),
    [assets, category],
  );
}
