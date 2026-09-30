import { createFileRoute, redirect } from "@tanstack/react-router";

/** Breaking was a market list — it is the oracle's feeds page now. */
export const Route = createFileRoute("/hot-topics")({
  beforeLoad: () => {
    throw redirect({ to: "/feeds" });
  },
});
