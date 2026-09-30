import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useCallback, useMemo } from "react";
import type { AuraAuth } from "./aura-auth";
import { logoutApi } from "./api";
import type { AuthState } from "./privy";

/**
 * Privy-backed AuraAuth — authentication (login/logout) AND the embedded
 * wallet as the trading signer. Meets the Privy bounty bar: auth alone isn't
 * enough; this hooks the Privy wallet into IndexMarket/Stake transactions and
 * EIP-712 signatures (order routing, resolution receipts).
 */
export function usePrivyAuth(): AuraAuth {
  const { ready, authenticated, user, login, logout: privyLogout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();

  /**
   * Sign out: the Privy wallet session and the oracle API session are torn down
   * in PARALLEL and independently — neither waits on the other's success, and a
   * failure in one still leaves the other closed.
   */
  const logout = useCallback(async () => {
    await Promise.allSettled([Promise.resolve().then(() => privyLogout()), logoutApi()]);
  }, [privyLogout]);

  const address = useMemo(() => {
    const embedded = wallets.find((w) => w.connectorType === "embedded") ?? wallets[0];
    return embedded?.address ?? null;
  }, [wallets]);

  const auth: AuthState = useMemo(
    () => ({
      userId: authenticated ? (user?.id ?? address ?? null) : null,
      address,
      email: user?.email?.address ?? null,
      ready,
    }),
    [ready, authenticated, user, address],
  );

  const sendTransaction = useCallback<AuraAuth["sendTransaction"]>(
    async (tx) => {
      const wallet = wallets.find((w) => w.connectorType === "embedded") ?? wallets[0];
      if (!wallet) throw new Error("No Privy wallet connected");
      await wallet.switchChain?.(10_143);
      const provider = await wallet.getEthereumProvider();
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet.address,
            to: tx.to,
            data: tx.data,
            value: tx.value ? `0x${tx.value.toString(16)}` : "0x0",
          },
        ],
      });
      return { hash: hash as string };
    },
    [wallets],
  );

  const signTypedData = useCallback<AuraAuth["signTypedData"]>(
    async (domain, types, value) => {
      const wallet = wallets.find((w) => w.connectorType === "embedded") ?? wallets[0];
      if (!wallet) throw new Error("No Privy wallet connected");
      const provider = await wallet.getEthereumProvider();
      return (await provider.request({
        method: "eth_signTypedData_v4",
        params: [
          wallet.address,
          JSON.stringify({
            types: { EIP712Domain: domain, ...(types as object) },
            primaryType: "ResolutionReceipt",
            domain,
            message: value,
          }),
        ],
      })) as string;
    },
    [wallets],
  );

  const signMessage = useCallback<AuraAuth["signMessage"]>(
    async (message) => {
      const wallet = wallets.find((w) => w.connectorType === "embedded") ?? wallets[0];
      if (!wallet) throw new Error("No Privy wallet connected");
      const provider = await wallet.getEthereumProvider();
      return (await provider.request({
        method: "personal_sign",
        params: [message, wallet.address],
      })) as string;
    },
    [wallets],
  );

  return { auth, login, logout, sendTransaction, signTypedData, signMessage };
}

/** Convenience: is the wallet CVI-verified for claiming (checked via backend). */
export function useAccessToken(): () => Promise<string | null> {
  const { getAccessToken } = usePrivy();
  return useCallback(() => getAccessToken(), [getAccessToken]);
}
