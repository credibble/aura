import { createFileRoute, redirect } from "@tanstack/react-router";

/** The explore grid is the index now — this old path forwards to it. */
export const Route = createFileRoute("/markets")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
