/**
 * Wallet-JWT gate for guarded mutations: ensures an EIP-191 oracle JWT exists
 * for the connected address before a POST/DELETE against the social API.
 */
import { useCallback, useContext } from "react";
import { getJwt, loginWithAddress } from "./api";
import { AuraAuthContext } from "./aura-auth";

export function useEnsureJwt(): () => Promise<void> {
  const ctx = useContext(AuraAuthContext);
  return useCallback(async () => {
    if (!ctx) throw new Error("Not signed in");
    const address = ctx.auth.address;
    if (!address) throw new Error("Connect a wallet first");
    if (getJwt()) return;
    await loginWithAddress(address, ctx.signMessage);
  }, [ctx]);
}
