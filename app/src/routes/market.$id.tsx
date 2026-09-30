import { createFileRoute, redirect } from "@tanstack/react-router";

/** Every market moved to /trade/:slug (a readable slug, never bytes32). */
export const Route = createFileRoute("/market/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$id", params: { id: params.id } });
  },
});
