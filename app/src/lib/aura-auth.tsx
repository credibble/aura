import { createContext, useContext } from "react";
import type { AuthState } from "../lib/privy";

/**
 * Aura auth context — consumed by the app to get the Privy user's state and
 * wallet address. The concrete provider (PrivyProvider) is wired in
 * `auth-provider`; when no VITE_PRIVY_APP_ID is set the app stays signed out
 * (no fake identity) and privileged actions throw.
 */
export interface AuraAuth {
  auth: AuthState;
  login: () => void | Promise<void>;
  logout: () => void | Promise<void>;
  /** Sign an IndexMarket / Stake transaction with the Privy embedded wallet. */
  sendTransaction: (tx: { to: string; data?: string; value?: bigint }) => Promise<{ hash: string }>;
  /** Sign an EIP-712 message (order-book routing / resolution receipts). */
  signTypedData: (domain: unknown, types: unknown, value: unknown) => Promise<string>;
  /** Sign an arbitrary EIP-191 message (oracle JWT login challenge). */
  signMessage: (message: string) => Promise<string>;
}

export const AuraAuthContext = createContext<AuraAuth | null>(null);

export function useAuraAuth(): AuraAuth {
  const ctx = useContext(AuraAuthContext);
  if (!ctx) throw new Error("useAuraAuth must be used within AuraAuthProvider");
  return ctx;
}
