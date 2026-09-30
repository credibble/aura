import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { AuraProvider } from "@/lib/aura-store";
import { SocialProvider } from "@/lib/social-store";
import { AuthProvider } from "@/lib/auth-provider";
import { useAuraAuth } from "@/lib/aura-auth";
import { initWs, wsSetUser } from "@/lib/ws";
import { FeedLayout } from "@/components/social/FeedLayout";
import { FeedSearch, SidebarFooter } from "@/components/social/RightSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

function NotFoundComponent() {
  // The root's not-found/error views render in place of RootComponent, i.e.
  // outside its providers — re-provide them so the X shell can render.
  return (
    <AuraProvider>
      <SocialProvider>
        <FeedLayout
          sidebar={
            <>
              <FeedSearch />
              <SidebarFooter />
            </>
          }
        >
          <div className="flex min-h-[60vh] items-center justify-center px-4">
            <div className="max-w-md text-center">
              {/* The page title is the h1; "404" is decoration, not the heading. */}
              <p aria-hidden="true" className="num text-7xl font-bold text-foreground">
                404
              </p>
              <h1 className="mt-4 text-xl font-semibold text-foreground">Page not found</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                The page you're looking for doesn't exist or has been moved.
              </p>
              <div className="mt-6">
                <Link
                  to="/"
                  className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Go home
                </Link>
              </div>
            </div>
          </div>
        </FeedLayout>
      </SocialProvider>
    </AuraProvider>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  // Same shell as the 404: a crashed page used to strip the rail away, stranding
  // the user with no navigation.
  return (
    <AuraProvider>
      <SocialProvider>
        <FeedLayout
          sidebar={
            <>
              <FeedSearch />
              <SidebarFooter />
            </>
          }
        >
          <div className="flex min-h-[60vh] items-center justify-center px-4">
            <div className="max-w-md text-center">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                This page didn't load
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Something went wrong on our end. You can try again or head back home.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    router.invalidate();
                    reset();
                  }}
                  className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Try again
                </button>
                <Link
                  to="/"
                  className="inline-flex items-center justify-center rounded-full border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  Go home
                </Link>
              </div>
            </div>
          </div>
        </FeedLayout>
      </SocialProvider>
    </AuraProvider>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Aura — The Internet Aura Market" },
      {
        name: "description",
        content:
          "Aura turns the internet's aura around people, projects, sports, crypto, AI and culture into markets you can discover, compare and trade.",
      },
      { name: "author", content: "Aura" },
      { property: "og:title", content: "Aura — The Internet Aura Market" },
      {
        property: "og:description",
        content:
          "Trade the internet's aura. Yes / No markets on every handle, each on its own window from 15 minutes to a day.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@aura" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Host+Grotesk:ital,wght@0,300..800;1,300..800&family=Roboto+Mono:wght@400;500&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // `suppressHydrationWarning` is required: the pre-paint theme script rewrites
    // the class on <html> before React hydrates (the standard theme pattern).
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Set the stored theme BEFORE first paint. Without this the server's
            hard-coded `dark` class painted first and the toggle only corrected it
            in an effect — a dark flash plus the wrong icon for light-mode users. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');document.documentElement.classList.toggle('dark',t!=='light');}catch(e){}})();",
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** Opens the push socket once and rebinds it whenever the wallet changes. */
function WsBridge() {
  const queryClient = useQueryClient();
  const { auth } = useAuraAuth();
  const address = auth.address?.toLowerCase() ?? null;

  useEffect(() => {
    initWs(queryClient);
  }, [queryClient]);
  useEffect(() => {
    wsSetUser(address);
  }, [address]);

  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* One tooltip provider for the whole app — every self-describing icon can
          rely on it, wherever it's rendered. */}
      <TooltipProvider delayDuration={200}>
        <AuthProvider>
          <WsBridge />
          <AuraProvider>
            <SocialProvider>
              <Outlet />
              <Toaster position="top-center" richColors />
            </SocialProvider>
          </AuraProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
