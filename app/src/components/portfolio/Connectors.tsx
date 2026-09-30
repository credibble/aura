import { useMemo, useState } from "react";
import { Link2, Link2Off, RefreshCw, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuraAuth } from "@/lib/aura-auth";
import { oauthUrl, shopifyUrl } from "@/lib/privy";
import { portfolio, type ConnectionLink, type HandleLink } from "@/lib/portfolio";

type Platform = {
  key: string;
  label: string;
  /** Logo URL — falls back to a colored monogram when unavailable. */
  logo?: string;
  color: string;
  shop?: boolean;
};

const PLATFORMS: Platform[] = [
  {
    key: "spotify",
    label: "Spotify",
    color: "#1DB954",
    logo: "https://upload.wikimedia.org/wikipedia/commons/1/19/Spotify_logo_without_text.svg",
  },
  {
    key: "x",
    label: "X",
    color: "#111111",
    logo: "https://upload.wikimedia.org/wikipedia/commons/6/6f/X_Logo_2023.svg",
  },
  {
    key: "github",
    label: "GitHub",
    color: "#181717",
    logo: "https://upload.wikimedia.org/wikipedia/commons/9/91/Octicons-mark-github.svg",
  },
  {
    key: "facebook",
    label: "Facebook",
    color: "#1877F2",
    logo: "https://upload.wikimedia.org/wikipedia/commons/5/51/Facebook_f_logo_%282019%29.svg",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    color: "#0A66C2",
    logo: "https://upload.wikimedia.org/wikipedia/commons/c/ca/LinkedIn_logo_initials.png",
  },
  {
    key: "twitch",
    label: "Twitch",
    color: "#9146FF",
    logo: "https://upload.wikimedia.org/wikipedia/commons/2/26/Twitch_logo.svg",
  },
  {
    key: "shopify",
    label: "Shopify",
    color: "#96BF48",
    logo: "https://upload.wikimedia.org/wikipedia/commons/0/0e/Shopify_logo_2018.svg",
    shop: true,
  },
];

/**
 * Connectors — one source connection per handle, shown as rows with a status
 * (Connected / Not connected) and an action (Connect / Reconnect / Disconnect).
 * OAuth is Supabase-facilitated for social; Shopify runs its own merchant flow.
 */
export function Connectors({
  handle,
  connection,
}: {
  handle: HandleLink;
  connection: ConnectionLink | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnectionLink | null>(connection);
  const { auth, login } = useAuraAuth();
  const redirect = typeof window !== "undefined" ? window.location.origin : "";

  const connected = conn?.status === "connected" || conn?.status === "reconnecting";

  const startOAuth = async (p: Platform) => {
    if (!auth.address) {
      void login();
      toast.info("Connect a wallet to link sources");
      return;
    }
    setBusy(p.key);
    try {
      const url = p.shop
        ? shopifyUrl(`${handle.id}-store`, redirect)
        : oauthUrl(p.key, handle.id, redirect);
      const res = await fetch(url);
      const j = (await res.json()) as { url?: string | null };
      if (j.url) window.location.href = j.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start OAuth");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!auth.address) {
      void login();
      toast.info("Connect a wallet first");
      return;
    }
    setBusy("disconnect");
    try {
      const next = await portfolio.disconnect(handle.id);
      if (next) setConn(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setBusy(null);
    }
  };

  const sorted = useMemo(() => {
    // Connected platform first, then alphabetical.
    return [...PLATFORMS].sort((a, b) => {
      const ac = a.key === conn?.platform ? 0 : 1;
      const bc = b.key === conn?.platform ? 0 : 1;
      return ac - bc || a.label.localeCompare(b.label);
    });
  }, [conn]);

  return (
    <section className="space-y-1.5">
      <div className="mb-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Link2 className="h-4 w-4" /> Connections
        </h2>
        <p className="text-sm text-muted-foreground">
          One source connection per handle — its adapter feeds metrics into @{handle.name}'s aura.
        </p>
      </div>
      {sorted.map((p) => {
        const isConnected = conn?.platform === p.key && connected;
        return (
          <div
            key={p.key}
            className={cn(
              "flex items-center gap-3 rounded-xl border p-2.5 transition-colors",
              isConnected && "border-primary/50 bg-primary/5",
            )}
          >
            <Avatar
              image={p.logo}
              seed={p.key}
              size={36}
              alt={p.label}
              className="border border-border bg-background"
            />

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {p.label}
                {p.shop && (
                  <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">store</span>
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {isConnected ? (p.shop ? conn.account : `@${conn.account}`) : "Not connected"}
              </p>
            </div>

            <Badge variant={isConnected ? "default" : "secondary"} className="shrink-0 text-[10px]">
              {isConnected ? "Connected" : "Off"}
            </Badge>

            {isConnected ? (
              <div className="flex shrink-0 gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void startOAuth(p)}
                  disabled={busy !== null}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={disconnect}
                  disabled={busy !== null}
                >
                  <Link2Off className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => void startOAuth(p)}
                disabled={busy !== null}
              >
                <PlugZap className="h-3.5 w-3.5" /> Connect
              </Button>
            )}
          </div>
        );
      })}
    </section>
  );
}
