/**
 * Wallet-JWT gate for guarded mutations: ensures an EIP-191 oracle JWT exists
 * for the connected address before a POST/DELETE against the social API.
 */
import { useCallback, useContext } from "react";
import { jwtStale, loginWithAddress } from "./api";
import { AuraAuthContext } from "./aura-auth";

export function useEnsureJwt(): () => Promise<void> {
  const ctx = useContext(AuraAuthContext);
  return useCallback(async () => {
    if (!ctx) throw new Error("Not signed in");
    const address = ctx.auth.address;
    if (!address) throw new Error("Connect a wallet first");
    // Re-mint when the token is absent OR stale — presence alone is not enough
    // (the 24 h oracle TTL would otherwise replay a dead bearer until 401).
    if (!jwtStale()) return;
    await loginWithAddress(address, ctx.signMessage);
  }, [ctx]);
}
