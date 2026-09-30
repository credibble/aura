/**
 * The wallet's network, and a way to fix it.
 *
 * Monad testnet is the home chain: every address the app talks to is deployed
 * there, so a wallet sitting on another chain can only fail — the writes would
 * revert, or worse, succeed against a different deployment. The write helpers
 * already switch silently before signing; this exposes the same switch as
 * something the user can see and invoke, and reports the current chain so the
 * UI can say why a button is disabled.
 */
import { useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { monad } from "./chain";

/** Monad's chain id as the hex string wallets speak. */
const HEX_CHAIN_ID = `0x${monad.id.toString(16)}`;

/**
 * What a wallet needs to ADD Monad when it has never seen the chain
 * (`wallet_switchEthereumChain` answers 4902 for an unknown chain).
 */
const ADD_CHAIN_PARAMS = {
  chainId: HEX_CHAIN_ID,
  chainName: monad.name,
  nativeCurrency: monad.nativeCurrency,
  rpcUrls: [monad.rpcUrls.default.http[0]],
  blockExplorerUrls: ["https://testnet.monadexplorer.com"],
};

export type ChainSwitchState = {
  /** A wallet is connected, so there is a chain to talk about. */
  hasWallet: boolean;
  /** The wallet's chain id, or null while it is unknown. */
  chainId: number | null;
  /** The wallet is on Monad testnet. */
  isMonad: boolean;
  /** A switch is in flight. */
  switching: boolean;
  /** Point the wallet at Monad, adding the chain if the wallet lacks it. */
  switchToMonad: () => Promise<void>;
};

export function useChainSwitch(): ChainSwitchState {
  const { wallets } = useWallets();
  const wallet = useMemo(
    () => wallets.find((w) => w.connectorType === "embedded") ?? wallets[0] ?? null,
    [wallets],
  );
  const [chainId, setChainId] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);

  // Read the chain from the wallet's own provider (Privy's `chainId` can lag an
  // external switch) and follow it, so a network change in the wallet is
  // reflected here without a reload.
  useEffect(() => {
    if (!wallet) {
      setChainId(null);
      return;
    }
    let alive = true;
    let detach: (() => void) | undefined;

    void (async () => {
      try {
        const provider = await wallet.getEthereumProvider();
        const read = async () => {
          try {
            const hex = (await provider.request({ method: "eth_chainId" })) as string;
            if (alive) setChainId(Number.parseInt(hex, 16));
          } catch {
            if (alive) setChainId(null);
          }
        };
        await read();
        const onChange = () => void read();
        provider.on?.("chainChanged", onChange);
        detach = () => provider.removeListener?.("chainChanged", onChange);
      } catch {
        if (alive) setChainId(null);
      }
    })();

    return () => {
      alive = false;
      detach?.();
    };
  }, [wallet]);

  const switchToMonad = useCallback(async () => {
    if (!wallet) return;
    setSwitching(true);
    try {
      const provider = await wallet.getEthereumProvider();
      try {
        // Privy's own helper where it exists (it also updates the wallet record).
        if (wallet.switchChain) await wallet.switchChain(monad.id);
        else await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: HEX_CHAIN_ID }] });
      } catch (error) {
        // 4902: the wallet does not know the chain — adding it also selects it.
        const code = (error as { code?: number }).code;
        if (code !== 4902 && code !== -32603) throw error;
        await provider.request({ method: "wallet_addEthereumChain", params: [ADD_CHAIN_PARAMS] });
      }
      setChainId(monad.id);
    } finally {
      setSwitching(false);
    }
  }, [wallet]);

  return {
    hasWallet: wallet !== null,
    chainId,
    isMonad: chainId === monad.id,
    switching,
    switchToMonad,
  };
}
