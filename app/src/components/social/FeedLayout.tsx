import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ChevronsLeft,
  ChevronsRight,
  Compass,
  Droplets,
  Home,
  MoreHorizontal,
  Rss,
  Trophy,
  Wallet,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HowItWorks } from "@/components/HowItWorks";
import { HandleAccountChip } from "@/components/portfolio/HandleAccountChip";
import { ConnectButton } from "@/components/ConnectButton";
import { useLoadHandles } from "@/lib/handle-store";
import { useAuraContracts } from "@/lib/contracts";
import { Navbar } from "@/components/Navbar";
import { FadeBox } from "@/components/ScrollRow";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// The app shell used by every page: left icon rail + center column + right
// sidebar on lg+. The rail is expandable — collapsed shows icons only, the
// toggle (bottom of the rail) opens the labeled 264px rail, and the preference
// is remembered in localStorage. Without a stored preference the rail follows
// the original CSS breakpoints (labels from 2xl up).
// The center column is capped at 840px and centred, so the shell reads at a
// sane measure on wide screens instead of stretching edge to edge. `wide` is
// kept for call-site compatibility but every page shares that one width; the
// grid still fits three cards at lg, the tables clear their 620px min-width,
// and the feed stays readable. Mobile falls back to the standard top Navbar.
// Users can't post — only @handles do.
// ----------------------------------------------------------------------------

const RAIL_KEY = "aura:rail";

type RailPref = "auto" | "on" | "off";

function railClass(active: boolean, wideRow: string) {
  return cn(
    // No `gap`: the label carries its own leading margin so collapsing it to zero
    // width removes the spacing too (no icon shift mid-animation).
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-secondary/70",
    "text-foreground",
    wideRow,
    active && "bg-secondary/60",
  );
}

/** The active rail link is also announced, not just tinted. */
function railAria(active: boolean): { "aria-current": "page" | undefined } {
  return { "aria-current": active ? "page" : undefined };
}

export function FeedLayout({
  children,
  sidebar,
  banner,
}: {
  children: ReactNode;
  sidebar?: ReactNode;
  /** Kept for call-site compatibility — every page shares one width now. */
  wide?: boolean;
  fluid?: boolean;
  /** Optional full-width bar at the very top of the shell (above rail/feed). */
  banner?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Topmost, full-width slot — spans the whole shell, not just the feed */}
      {banner}
      {/* Keyboard users land here first: without it they tab through the whole
          rail (≈10 links) on every page to reach the content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>
      {/* Mobile keeps the standard top navbar; desktop uses the icon rail */}
      <div className="lg:hidden">
        <Navbar />
      </div>
      {/* One shell width for every page. The outer frame only needs to hold the
          max rail (264) + centre (840) + aside (350) ≈ 1454px, so 1440 removes
          the dead gutters the old 1600 left on 1440p/4K screens. */}
      <div className="mx-auto flex w-full max-w-[1440px] justify-center">
        <LeftRail />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto min-h-screen w-full min-w-0 max-w-[840px] flex-1 border-x border-border outline-none"
        >
          {children}
        </main>
        {sidebar && (
          <aside className="hidden w-[350px] shrink-0 px-6 py-3 lg:block">
            <FadeBox className="sticky top-3 max-h-[calc(100vh-1.5rem)] space-y-4 pb-4">
              {sidebar}
            </FadeBox>
          </aside>
        )}
      </div>
    </div>
  );
}

function LeftRail() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Explore owns the grid and every trade page, so something is always lit.
  const isExplore = pathname === "/" || pathname.startsWith("/trade");
  const { address } = useAuraContracts();
  useLoadHandles(address);

  // Expandable rail: explicit preference wins, otherwise the original CSS
  // breakpoints (2xl) apply. Synced from localStorage after hydration so SSR
  // markup always matches the first client render.
  const [pref, setPref] = useState<RailPref>("auto");
  useEffect(() => {
    const stored = window.localStorage.getItem(RAIL_KEY);
    if (stored === "1") setPref("on");
    else if (stored === "0") setPref("off");
  }, []);

  const toggleRail = () => {
    const next: RailPref = pref === "on" ? "off" : "on";
    setPref(next);
    try {
      window.localStorage.setItem(RAIL_KEY, next === "on" ? "1" : "0");
    } catch {
      /* private mode — the choice simply isn't remembered */
    }
  };

  // Classes that widen a rail row when the rail is expanded.
  const wideRow =
    pref === "on"
      ? "xl:w-full xl:justify-start xl:px-3"
      : pref === "off"
        ? ""
        : "2xl:w-full 2xl:justify-start 2xl:px-3";
  /**
   * Rail labels never unmount — they collapse to zero width and fade, so the
   * expand/collapse animates instead of snapping (display:none can't transition).
   */
  const labelBase = "overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-200 ease-out";
  const label =
    pref === "on"
      ? `${labelBase} ml-4 max-w-[200px] opacity-100 text-[19px] leading-none`
      : pref === "off"
        ? `${labelBase} ml-0 max-w-0 opacity-0 text-[19px] leading-none`
        : `${labelBase} ml-0 max-w-0 opacity-0 text-[19px] leading-none 2xl:ml-4 2xl:max-w-[200px] 2xl:opacity-100`;
  // Same visibility rules as `label`, but without the rail's text sizing —
  // used for the Connect Wallet button's text spans.
  const btnLabel = pref === "on" ? "inline" : pref === "off" ? "hidden" : "hidden 2xl:inline";
  const wideNav =
    pref === "on"
      ? "xl:w-[264px] xl:items-stretch xl:px-4"
      : pref === "off"
        ? ""
        : "2xl:w-[264px] 2xl:items-stretch 2xl:px-4";
  // The width/padding changes animate; the labels already transition.
  const navMotion = "transition-[width,padding] duration-200 ease-out";
  // Toggle icons flip at the same breakpoint the rail expands on.
  const expandCls = pref === "on" ? "xl:hidden" : pref === "off" ? "" : "2xl:hidden";
  const collapseCls =
    pref === "on" ? "hidden xl:block" : pref === "off" ? "hidden" : "hidden 2xl:block";

  return (
    <nav
      aria-label="Feed"
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col items-center gap-1 px-3 py-3 lg:flex",
        navMotion,
        wideNav,
      )}
    >
      {/* Wordmark */}
      <Link
        to="/"
        className={cn(
          "mb-2 flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-secondary/70",
          pref === "on" ? "xl:mb-4" : pref === "auto" && "2xl:mb-4",
        )}
        aria-label="Aura home"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Home className="h-4 w-4" strokeWidth={2.6} />
        </span>
      </Link>

      {/* Explore — the index grid + every trade page */}
      <Link
        to="/"
        className={railClass(isExplore, wideRow)}
        aria-label="Explore"
        {...railAria(isExplore)}
      >
        <Compass className="h-6 w-6 shrink-0" strokeWidth={isExplore ? 2.4 : 2} />
        <span className={label}>Explore</span>
      </Link>

      {/* Feeds — the oracle's published digests */}
      <Link
        to="/feeds"
        className={railClass(pathname.startsWith("/feeds"), wideRow)}
        aria-label="Feeds"
        {...railAria(pathname.startsWith("/feeds"))}
      >
        <Rss className="h-6 w-6 shrink-0" strokeWidth={pathname.startsWith("/feeds") ? 2.4 : 2} />
        <span className={label}>Feeds</span>
      </Link>

      {/* Leaderboard */}
      <Link
        to="/leaderboard"
        className={railClass(pathname.startsWith("/leaderboard"), wideRow)}
        aria-label="Leaderboard"
        {...railAria(pathname.startsWith("/leaderboard"))}
      >
        <Trophy
          className="h-6 w-6 shrink-0"
          strokeWidth={pathname.startsWith("/leaderboard") ? 2.4 : 2}
        />
        <span className={label}>Leaderboard</span>
      </Link>

      {/* Portfolio */}
      <Link
        to="/portfolio"
        className={railClass(pathname.startsWith("/portfolio"), wideRow)}
        aria-label="Portfolio"
        {...railAria(pathname.startsWith("/portfolio"))}
      >
        <Wallet
          className="h-6 w-6 shrink-0"
          strokeWidth={pathname.startsWith("/portfolio") ? 2.4 : 2}
        />
        <span className={label}>Portfolio</span>
      </Link>

      {/* Liquidity pool */}
      <Link
        to="/pool"
        className={railClass(pathname.startsWith("/pool"), wideRow)}
        aria-label="Pool"
        {...railAria(pathname.startsWith("/pool"))}
      >
        <Droplets
          className="h-6 w-6 shrink-0"
          strokeWidth={pathname.startsWith("/pool") ? 2.4 : 2}
        />
        <span className={label}>Pool</span>
      </Link>

      {/* Connect wallet - the desktop login affordance (Navbar's ConnectButton
          is lg:hidden; without this the rail had no way to sign in) */}
      <div className={cn("mt-1 w-11 shrink-0", wideRow)}>
        <ConnectButton
          disconnectedLabel="Sign in"
          labelClassName={btnLabel}
          className="h-11 w-full justify-center rounded-lg gap-3 xl:justify-start"
        />
      </div>

      <div className="flex-1" />

      {/* Expand / collapse the rail (preference persisted) */}
      <button
        type="button"
        onClick={toggleRail}
        aria-label={pref === "on" ? "Collapse menu" : "Expand menu"}
        aria-expanded={pref === "on"}
        className={railClass(false, wideRow)}
      >
        <span className="relative grid h-6 w-6 shrink-0 place-items-center">
          <ChevronsRight className={cn("h-5 w-5", expandCls)} />
          <ChevronsLeft className={cn("h-5 w-5", collapseCls)} />
        </span>
        <span className={label}>{pref === "on" ? "Collapse" : "Expand"}</span>
      </button>

      {/* More menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={railClass(false, wideRow)} aria-label="More">
            <MoreHorizontal className="h-6 w-6 shrink-0" />
            <span className={label}>More</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" sideOffset={10} className="w-56">
          <DropdownMenuItem asChild>
            <Link to="/saved">Saved</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/notifications">Notifications</Link>
          </DropdownMenuItem>
          <HowItWorks>
            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>How it works</DropdownMenuItem>
          </HowItWorks>
          <DropdownMenuItem asChild>
            <Link to="/terms">Terms of Service</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/privacy">Privacy Policy</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Account chip — click goes to /portfolio (theme toggle lives inside) */}
      <HandleAccountChip
        labelClassName={btnLabel}
        toggleClassName={pref === "off" ? "hidden" : pref === "auto" ? "hidden 2xl:flex" : ""}
      />
    </nav>
  );
}
