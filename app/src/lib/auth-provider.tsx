import { useMemo, type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { toast } from "sonner";
import { AuraAuthContext, type AuraAuth } from "./aura-auth";
import { PRIVY_APP_ID } from "./privy";
import { usePrivyAuth } from "./privy-auth";

/** Bridges the Privy hooks into the app's AuraAuth context. */
function PrivyBridge({ children }: { children: ReactNode }) {
  const auth = usePrivyAuth();
  return <AuraAuthContext.Provider value={auth}>{children}</AuraAuthContext.Provider>;
}

/**
 * AuthProvider — Privy (authentication + embedded wallet beyond login: the
 * wallet signs trades/stakes/claims). When VITE_PRIVY_APP_ID is not
 * configured, auth stays SIGNED-OUT (no fake identity) and every privileged
 * action throws, so the UI shows its connect-wallet states.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const unconfigured: AuraAuth = useMemo(
    () => ({
      auth: { userId: null, address: null, email: null, ready: false },
      login: () => {
        // Never throw synchronously — callers run `void login()` from onClick
        // handlers, where a sync throw becomes an unhandled rejection.
        toast.error("Wallet sign-in isn't configured", {
          description: "Set VITE_PRIVY_APP_ID to enable sign-in.",
        });
      },
      logout: () => {},
      sendTransaction: async () => {
        throw new Error("No wallet — set VITE_PRIVY_APP_ID");
      },
      signTypedData: async () => {
        throw new Error("No wallet — set VITE_PRIVY_APP_ID");
      },
      signMessage: async () => {
        throw new Error("No wallet — set VITE_PRIVY_APP_ID");
      },
    }),
    [],
  );

  if (!PRIVY_APP_ID) {
    return <AuraAuthContext.Provider value={unconfigured}>{children}</AuraAuthContext.Provider>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
        },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}
