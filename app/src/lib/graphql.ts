/**
 * Subgraph GraphQL client — the frontend reads on-chain indexed data (handles,
 * windows, trades, orders, fills, aura history, stakers) DIRECTLY from the
 * subgraph. No backend intermediary: the oracle API is only used for
 * backend-owned data (posts, comments, follows, notifications, auth).
 */

export const SUBGRAPH_URL = (import.meta.env.VITE_SUBGRAPH_URL ??
  "http://localhost:8000/subgraphs/name/aura/aura") as string;

export class GraphqlError extends Error {
  constructor(
    message: string,
    readonly errors?: string[],
  ) {
    super(message);
  }
}

/** POST a GraphQL query; throws GraphqlError on transport/schema failures. */
export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  }).catch((error: Error) => {
    throw new GraphqlError(`subgraph unreachable: ${error.message}`);
  });
  if (!res.ok) throw new GraphqlError(`subgraph HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new GraphqlError(
      json.errors[0]!.message,
      json.errors.map((e) => e.message),
    );
  }
  if (!json.data) throw new GraphqlError("subgraph returned no data");
  return json.data;
}
