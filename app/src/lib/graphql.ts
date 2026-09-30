/**
 * Indexer GraphQL client — the frontend reads indexed chain state (handles,
 * windows, trades, orders, fills, aura history, stakers) DIRECTLY from the
 * HyperIndex GraphQL API. No backend intermediary: the oracle API is only used
 * for backend-owned data (posts, comments, follows, notifications, auth).
 *
 * Subscriptions use the SAME endpoint over WebSocket — see `lib/indexer-ws.ts`.
 */

export const INDEXER_URL = (import.meta.env.VITE_INDEXER_URL ??
  "http://localhost:8080/v1/graphql") as string;

/** The same endpoint over WebSocket: http → ws, https → wss. */
export const INDEXER_WS_URL = (import.meta.env.VITE_INDEXER_WS_URL ??
  INDEXER_URL.replace(/^http/, "ws")) as string;

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
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  }).catch((error: Error) => {
    throw new GraphqlError(`indexer unreachable: ${error.message}`);
  });
  if (!res.ok) throw new GraphqlError(`indexer HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new GraphqlError(
      json.errors[0]!.message,
      json.errors.map((e) => e.message),
    );
  }
  if (!json.data) throw new GraphqlError("indexer returned no data");
  return json.data;
}
