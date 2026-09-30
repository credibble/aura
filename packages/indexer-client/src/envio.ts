import type { Handle } from "./types";
import { HANDLE_FIELDS } from "./queries";

export type EnvioConfig = {
  /** Envio HyperIndex GraphQL endpoint (like a subgraph URL). */
  url?: string;
  /** Envio HyperSync base URL (e.g. https://indexer.bigdevenergy.link). */
  hyperSyncUrl?: string;
  /** Envio HyperRPC endpoint. */
  hyperRpcUrl?: string;
  /** The indexer/contract address to scope HyperSync queries to. */
  contractAddress?: string;
};

/**
 * Envio integration — HyperIndex (GraphQL), HyperSync (fast indexed responses)
 * and HyperRPC (getLogs-style access) powering Aura's real on-chain data path.
 * The oracle can point SUBGRAPH_URL at a HyperIndex GraphQL endpoint, and the
 * frontend can read windows/trades through HyperSync for instant backfill.
 */
export class EnvioClient {
  readonly url?: string;
  readonly hyperSyncUrl?: string;
  readonly hyperRpcUrl?: string;
  readonly contractAddress?: string;

  constructor(config: EnvioConfig = {}) {
    this.url = config.url?.replace(/\/$/, "");
    this.hyperSyncUrl = (
      config.hyperSyncUrl ?? process.env.ENVIO_HYPERSYNC_URL
    )?.replace(/\/$/, "");
    this.hyperRpcUrl = (
      config.hyperRpcUrl ?? process.env.ENVIO_HYPERRPC_URL
    )?.replace(/\/$/, "");
    this.contractAddress =
      config.contractAddress ?? process.env.ENVIO_CONTRACT_ADDRESS;
  }

  // --- HyperIndex (GraphQL, subgraph-compatible) -----------------------------

  async graphql<T>(
    gql: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.url)
      throw new Error("EnvioClient requires a HyperIndex `url` (or ENVIO_URL)");
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: gql, variables: variables ?? {} }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`envio HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: T;
      errors?: { message?: string }[];
    };
    if (json.errors?.length)
      throw new Error(`envio query error: ${json.errors[0]?.message}`);
    if (!json.data) throw new Error("envio returned no data");
    return json.data;
  }

  /** Handles via HyperIndex GraphQL (same entity shape as the subgraph). */
  async handles(first = 100): Promise<Handle[]> {
    const data = await this.graphql<{ handles: Handle[] }>(
      `query($first: Int!) { handles(first: $first) { ${HANDLE_FIELDS} } }`,
      { first },
    );
    return data.handles;
  }

  // --- HyperSync (REST: indexer responses, batch-friendly) -------------------

  /**
   * Query the HyperSync indexer API. The request is an Envio query object;
   * the response is a stream of indexed responses (filters → rows). Used for
   * instant backfill of windows/trades without waiting on a slow reorg window.
   */
  async hyperSync<T>(request: Record<string, unknown>): Promise<T[]> {
    if (!this.hyperSyncUrl)
      throw new Error(
        "EnvioClient requires hyperSyncUrl (or ENVIO_HYPERSYNC_URL)",
      );
    const res = await fetch(`${this.hyperSyncUrl}/v1/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contractAddress: this.contractAddress,
        ...request,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`envio hypersync HTTP ${res.status}`);
    const json = (await res.json()) as { responses?: T[] };
    return json.responses ?? [];
  }

  // --- HyperRPC (raw log access, like eth_getLogs at scale) ------------------

  /** Fetch indexed logs for a contract from HyperRPC. */
  async logs(
    topics: string[],
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<unknown[]> {
    if (!this.hyperRpcUrl)
      throw new Error(
        "EnvioClient requires hyperRpcUrl (or ENVIO_HYPERRPC_URL)",
      );
    const res = await fetch(this.hyperRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "envio_getLogs",
        params: [
          {
            address: this.contractAddress,
            topics,
            fromBlock: fromBlock.toString(),
            toBlock: toBlock.toString(),
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`envio hyperrpc HTTP ${res.status}`);
    const json = (await res.json()) as { result?: unknown[] };
    return json.result ?? [];
  }
}
