import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { isPollable } from "@/lib/poll-registry";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Observer-gated intervals: queries opt in via `meta.pollMs`; the
        // tick runs only while the document + owning surface are visible.
        refetchInterval: (query) =>
          isPollable(query.queryKey, (query.meta as { pollMs?: number } | undefined)?.pollMs),
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
