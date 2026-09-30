import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Compass, Droplets, Menu, Rss, Trophy, Wallet, Activity } from "lucide-react";
import { SearchPopover } from "@/components/SearchPopover";
import { ConnectButton } from "@/components/ConnectButton";
import { HowItWorks } from "@/components/HowItWorks";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollRow } from "@/components/ScrollRow";
import { CATEGORIES } from "@/lib/aura-data";
import { cn } from "@/lib/utils";

const browse = [
  { label: "Explore", to: "/", icon: Compass },
  { label: "Feeds", to: "/feeds", icon: Rss },
  { label: "Leaderboard", to: "/leaderboard", icon: Trophy },
  { label: "Pool", to: "/pool", icon: Droplets },
  { label: "Portfolio", to: "/portfolio", icon: Wallet },
] as const;

function active(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function Navbar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const routerHash = useRouterState({ select: (s) => s.location.hash });
  // Fragments never reach the server — apply the hash only after hydration so
  // the active-tab state doesn't mismatch the SSR markup.
  const [hash, setHash] = useState("");
  useEffect(() => setHash(routerHash), [routerHash]);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-nav/95 backdrop-blur">
      <div className="mx-auto flex h-14 items-center gap-3 px-3 sm:px-4 lg:px-6">
        <MobileNav pathname={pathname} />
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="h-4 w-4" strokeWidth={2.6} />
          </span>
          <span className="text-lg font-bold tracking-tight">Aura</span>
        </Link>
        <div className="hidden min-w-0 max-w-md flex-1 sm:block">
          <SearchPopover />
        </div>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <HowItWorks>
            <button className="hidden items-center gap-1.5 px-2 text-sm text-muted-foreground hover:text-foreground md:inline-flex">
              <span className="grid h-4 w-4 place-items-center rounded-full border border-muted-foreground text-[10px]">
                i
              </span>
              How it works
            </button>
          </HowItWorks>
          <ThemeToggle className="hidden md:flex" />
          <ConnectButton />
        </div>
      </div>

      <nav aria-label="Categories">
        <ScrollRow activeKey={`${pathname}#${hash}`} className="gap-1 px-3 sm:px-4 lg:px-6">
          {browse.map((item) => {
            const Icon = item.icon;
            const on = active(pathname, item.to) && (item.to !== "/" || !hash);
            return (
              <Link
                key={item.label}
                to={item.to}
                data-active={on ? "true" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-sm font-medium",
                  on
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
          <span className="mx-2 h-4 w-px shrink-0 bg-border" />
          {CATEGORIES.map((c) => {
            const on = pathname === "/" && hash === c.id;
            return (
              <Link
                key={c.id}
                to="/"
                hash={c.id}
                data-active={on ? "true" : undefined}
                className={cn(
                  "shrink-0 border-b-2 px-2.5 py-2.5 text-sm font-medium",
                  on
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {c.label}
              </Link>
            );
          })}
        </ScrollRow>
      </nav>
    </header>
  );
}

function MobileNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 border-border bg-nav p-0">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <div className="flex h-14 items-center border-b border-border px-4 text-lg font-bold">
          Aura
        </div>
        <div className="flex flex-col gap-1 p-3">
          {browse.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2 text-sm hover:bg-secondary"
            >
              {item.label}
            </Link>
          ))}
          {CATEGORIES.map((c) => (
            <Link
              key={c.id}
              to="/"
              hash={c.id}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {c.label}
            </Link>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
