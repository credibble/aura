import { createFileRoute, redirect } from "@tanstack/react-router";

/** Post detail is gone — the feed lives inside each trade page's tabs. */
export const Route = createFileRoute("/post/$id")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
