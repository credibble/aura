import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { userHandlesOptions } from "@/queries/user";
import type { IndexerHandle } from "@/queries/handles";
import { CONTRACTS } from "./chain";
import type { HandleLink } from "./portfolio";

/**
 * Active-handle store — the currently selected handle on the sidebar "You"
 * chip. Loads the wallet's OWNED handles straight from the indexer (owner
 * filter) and keeps the chip popover and the portfolio page in sync without
 * prop drilling. No mock fallback: an address with no handles loads empty.
 */
export type HandleState = {
  handles: HandleLink[];
  activeId: string;
  loading: boolean;
};

let state: HandleState = { handles: [], activeId: "", loading: false };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getHandleState(): HandleState {
  return state;
}

export function setActiveHandle(id: string): void {
  state = { ...state, activeId: id };
  emit();
}

export function setHandles(handles: HandleLink[]): void {
  state = { handles, activeId: state.activeId || handles[0]?.id || "", loading: false };
  emit();
}

/** Indexer handle → the portfolio's handle link (real on-chain fields). */
function toHandleLink(h: IndexerHandle): HandleLink {
  return {
    id: h.id,
    name: h.name ?? h.symbol ?? h.id,
    symbol: h.symbol ?? "",
    aura: Number(h.aura) / 100,
    sources: h.sources,
    stake: h.stake,
    pool: CONTRACTS.pool ?? "",
    contract: h.contract,
  };
}

/** Load the wallet's owned handles into the store (idempotent, real data). */
export function useLoadHandles(address: string | null): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!address) {
      setHandles([]);
      return;
    }
    let alive = true;
    state = { ...state, loading: true };
    emit();
    void qc
      .fetchQuery(userHandlesOptions(address))
      .then((rows) => {
        if (alive) setHandles(rows.map(toHandleLink));
      })
      .catch(() => {
        if (alive) setHandles([]);
      });
    return () => {
      alive = false;
    };
  }, [address, qc]);
}

/** Refetch the wallet's owned handles into the store (after a handle is
 *  created — the effect above only reloads on address change). */
export async function reloadHandles(qc: QueryClient, address: string): Promise<void> {
  try {
    const rows = await qc.fetchQuery({ ...userHandlesOptions(address), staleTime: 0 });
    setHandles(rows.map(toHandleLink));
  } catch {
    /* keep the current store contents */
  }
}

/** Subscribe to the active-handle state (React hook). */
export function useHandles(): HandleState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getHandleState,
    getHandleState,
  );
}
