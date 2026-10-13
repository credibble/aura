import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2Off, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { useAuraAuth } from "@/lib/aura-auth";
import { notifyError } from "@/lib/notify";
import { oauthUrl, shopifyUrl } from "@/lib/privy";
import { platformLogo } from "@/lib/platform-logos";
import { portfolio, type ConnectionLink, type HandleLink } from "@/lib/portfolio";
import { qk } from "@/queries/keys";

type Platform = {
  key: string;
  label: string;
  /** What the connection feeds into the handle's aura. */
  feeds: string;
  shop?: boolean;
};

/** Logo comes from the shared, vendored set (`@/lib/platform-logos`). */
const PLATFORMS: Platform[] = [
  { key: "x", label: "X", feeds: "posts, reposts and replies" },
  { key: "youtube", label: "YouTube", feeds: "uploads, views and comment volume" },
  { key: "reddit", label: "Reddit", feeds: "subreddit mentions and upvotes" },
  { key: "instagram", label: "Instagram", feeds: "posts, reels and reach" },
  { key: "spotify", label: "Spotify", feeds: "streams and playlist adds" },
  { key: "github", label: "GitHub", feeds: "commits, stars and release activity" },
  { key: "twitch", label: "Twitch", feeds: "stream hours and chat volume" },
  { key: "facebook", label: "Facebook", feeds: "page posts and reactions" },
  { key: "linkedin", label: "LinkedIn", feeds: "company posts and reach" },
  { key: "shopify", label: "Shopify", feeds: "orders and storefront traffic", shop: true },
];

/**
 * Connections as a quiet row of platform marks: one tap opens a small popover
 * with the account it feeds, what it contributes to the aura index, and the one
 * action that applies (connect, reconnect, disconnect). No OAuth redirect until
 * you ask for it.
 */
export function ConnectionsRow({
  handle,
  connection,
}: {
  handle: HandleLink;
  connection: ConnectionLink | null;
}) {
  const [conn, setConn] = useState<ConnectionLink | null>(connection);
  const [busy, setBusy] = useState<string | null>(null);
  const { auth, login } = useAuraAuth();
  const qc = useQueryClient();

  useEffect(() => {
    setConn(connection);
  }, [connection]);

  const active = conn?.platform ?? null;
  const connected = conn?.status === "connected" || conn?.status === "reconnecting";

  const startOAuth = async (p: Platform) => {
    if (!auth.address) {
      void login();
      toast.info("Connect a wallet to link sources");
      return;
    }
    setBusy(p.key);
    try {
      // The oracle callback exchanges the code and returns the browser to this
      // exact page; the app reads the `?connection=` flag on the way back.
      const url = p.shop
        ? shopifyUrl(`${handle.id}-store`, window.location.origin)
        : oauthUrl(p.key, handle.id, window.location.href);
      const res = await fetch(url);
      const j = (await res.json()) as { url?: string | null };
      if (j.url) window.location.href = j.url;
      else toast.info("This platform isn't configured on the oracle yet");
    } catch (e) {
      notifyError(e, "Connect");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!auth.address) {
      void login();
      return;
    }
    setBusy("disconnect");
    try {
      const next = await portfolio.disconnect(handle.id);
      setConn(next);
      void qc.invalidateQueries({ queryKey: qk.stake("stats", handle.stake) });
      toast.success("Disconnected");
    } catch (e) {
      notifyError(e, "Disconnect");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PLATFORMS.map((p) => {
        const isOn = active === p.key && connected;
        const logo = platformLogo(p.key);
        return (
          <Popover key={p.key}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${p.label} connection`}
                    className={cn(
                      "relative rounded-full p-[2px] transition-colors",
                      isOn ? "gradient-ring" : "bg-transparent hover:bg-secondary",
                    )}
                  >
                    <Avatar
                      image={logo}
                      seed={p.key}
                      size={34}
                      alt={p.label}
                      className={cn(
                        "border border-border/70 bg-background",
                        !isOn && "opacity-70 transition-opacity hover:opacity-100",
                      )}
                    />
                    {isOn && (
                      <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-up text-up-foreground ring-2 ring-background">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>{p.label}</TooltipContent>
            </Tooltip>

            <PopoverContent
              align="start"
              sideOffset={8}
              className="w-[min(300px,calc(100vw-2rem))] rounded-2xl border-border/70 bg-card p-3.5 shadow-xl"
            >
              <div className="flex items-center gap-2.5">
                <Avatar
                  image={logo}
                  seed={p.key}
                  size={34}
                  alt={p.label}
                  className="border border-border/70 bg-background"
                />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-sm font-semibold">
                    {p.label}
                    {p.shop && (
                      <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">
                        store
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {isOn ? (p.shop ? conn.account : `@${conn?.account ?? ""}`) : "Not connected"}
                  </div>
                </div>
                {isOn && <span className="h-2 w-2 shrink-0 rounded-full bg-up" />}
              </div>

              <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
                Feeds <span className="text-foreground">{p.feeds}</span> into @{handle.name}&apos;s
                aura index.
              </p>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void startOAuth(p)}
                  disabled={busy !== null}
                  className={cn(
                    "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold transition-colors",
                    isOn
                      ? "border border-border/70 text-foreground hover:bg-secondary"
                      : "bg-primary text-primary-foreground hover:brightness-110",
                  )}
                >
                  {busy === p.key ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isOn ? (
                    <RefreshCw className="h-3.5 w-3.5" />
                  ) : null}
                  {isOn ? "Reconnect" : "Connect"}
                </button>
                {isOn && (
                  <button
                    type="button"
                    onClick={() => void disconnect()}
                    disabled={busy !== null}
                    aria-label="Disconnect"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border/70 text-muted-foreground transition-colors hover:border-down/60 hover:text-down"
                  >
                    {busy === "disconnect" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Link2Off className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}

/** Convenience wrapper that loads the handle's connection once. */
export function ConnectionsSection({
  handle,
  connection,
}: {
  handle: HandleLink;
  connection: ConnectionLink | null;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["handle-connection", handle.id],
    queryFn: () => portfolio.connection(handle.id),
    initialData: connection ?? undefined,
    staleTime: 15_000,
  });

  // The oracle bounces the browser back here with `?connection=<platform>:<result>`
  // after an OAuth exchange. Surface it, then drop the flag so a refresh is clean.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("connection");
    if (!status) return;
    const [platform, result] = status.split(":");
    if (result === "connected") toast.success(`${platform} connected`);
    else toast.error(`Couldn't connect ${platform}`);
    params.delete("connection");
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    void qc.invalidateQueries({ queryKey: ["handle-connection", handle.id] });
  }, [handle.id, qc]);

  return (
    <section>
      <h2 className="text-sm font-semibold">Connections</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        One feed per platform — each connection is a source behind @{handle.name}&apos;s aura.
      </p>
      <div className="mt-3">
        <ConnectionsRow handle={handle} connection={data ?? null} />
      </div>
    </section>
  );
}
