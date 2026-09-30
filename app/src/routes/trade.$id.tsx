import { createFileRoute, redirect } from "@tanstack/react-router";

/** Every market lives at the root slug now (`/playstation`). */
export const Route = createFileRoute("/trade/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$id", params: { id: params.id } });
  },
});
