import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy /asset/:id links forward to the trade page. */
export const Route = createFileRoute("/asset/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$id", params: { id: params.id } });
  },
});
