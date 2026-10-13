/**
 * Aura handle-graduation Chainlink CRE workflow.
 *
 * A cron-triggered workflow that graduates handles once they clear the aura
 * bar: on schedule it queries the Envio indexer for handles that are NOT yet
 * graduated but have `aura > minGraduationAura` (1e2-scaled; 1000 = 10.00),
 * and delivers ONE consensus-signed report to the graduation consumer contract
 * on Monad testnet, which then calls `Handle.setGraduated(true)` on each
 * candidate. The consumer must be the handle's `auraUpdater` (the oracle
 * relayer) or the HandleFactory owner — `setGraduated` is `onlyProtocol`.
 *
 * CRE's write model: the workflow never calls Handle directly. It ABI-encodes
 * the candidate list, generates a signed report (`runtime.report`), and delivers
 * it through the chain's Keystone Forwarder via `EVMClient.writeReport` to the
 * consumer's `onReport`, which performs the on-chain calls.
 *
 * Reads go through Envio (HyperSync-backed index), never a raw RPC scan, and the
 * HTTP read is consensus-aggregated across DON nodes.
 *
 * One target — Monad testnet (selector `2183018362218727504`), no mainnet/production.
 * The receiver-free `local-simulation` target exercises the real read + decision
 * path before the consumer contract exists; the production `testnet-settings`
 * target requires the deployed consumer address and fails closed without it.
 */
import {
  CronCapability,
  EVMClient,
  HTTPClient,
  Runner,
  TxStatus,
  bytesToBase64,
  bytesToHex,
  consensusIdenticalAggregation,
  getNetwork,
  handler,
  json,
  ok,
  prepareReportRequest,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import {
  encodeAbiParameters,
  isAddress,
  parseAbiParameters,
  zeroAddress,
  type Address,
} from "viem";

export type Config = {
  /** Cron schedule (every 15 minutes by default). */
  schedule: string;
  /** CRE chain selector name — `monad-testnet` (the only target). */
  chainSelectorName: string;
  /** The Envio indexer GraphQL endpoint — HyperSync-backed, `/v1/graphql`. */
  indexerUrl: string;
  /** Aura floor (1e2-scaled) — graduate handles strictly above this (1000 = 10.00). */
  minGraduationAura: string;
  /** Local-simulation discriminator; production configs must NOT set this. */
  mode?: "local-simulation";
  /** The deployed graduation consumer contract on Monad testnet (production only). */
  consumerAddress?: string;
  /** uint64 gas limit (decimal string) for the report delivery (production only). */
  gasLimit?: string;
};

type IndexedHandle = {
  contract: string;
  aura: string;
};

/**
 * Handles that cleared the aura bar but aren't graduated yet — Envio's own
 * dialect (`where` with `_eq`/`_gt` filters), the same shape the app's
 * `queries/handles.ts` uses.
 */
const GRADUATION_QUERY = `
  query($minAura: numeric!, $limit: Int) {
    Handle(
      where: { graduated: { _eq: false }, aura: { _gt: $minAura } }
      order_by: { aura: desc }
      limit: $limit
    ) {
      contract
      aura
    }
  }
`;

/**
 * One consensus-verified HTTP read of the HyperSync-backed index, run
 * independently on every DON node. The POST body is protobuf bytes as base64.
 */
const fetchCandidates = (
  sender: HTTPSendRequester,
  url: string,
  minAura: string,
  limit: number,
): IndexedHandle[] => {
  const body = bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({ query: GRADUATION_QUERY, variables: { minAura, limit } }),
    ),
  );
  const response = sender
    .sendRequest({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cacheSettings: { store: false },
    })
    .result();
  if (!ok(response)) throw new Error(`indexer HTTP ${response.statusCode}`);
  const parsed = json(response) as { data?: { Handle?: IndexedHandle[] } };
  if (!Array.isArray(parsed?.data?.Handle))
    throw new Error("indexer response missing Handle[]");
  return parsed.data.Handle;
};

export const onCron = (runtime: Runtime<Config>): string => {
  const { indexerUrl, chainSelectorName, minGraduationAura, mode } =
    runtime.config;

  // Real consensus fetch — every DON node queries the live index.
  const candidates = new HTTPClient()
    .sendRequest(
      runtime,
      fetchCandidates,
      consensusIdenticalAggregation<IndexedHandle[]>(),
    )(indexerUrl, minGraduationAura, 100)
    .result();

  if (candidates.length === 0) {
    runtime.log("CRE: no handles above the aura bar — nothing to graduate");
    return JSON.stringify({
      mode: mode ?? "production",
      graduated: 0,
      note: "no-candidates",
    });
  }

  runtime.log(
    `CRE: ${candidates.length} handles with aura > ${minGraduationAura} to graduate`,
  );

  // Receiver-free local simulation: real read + decision, then a labeled result
  // and an early return — no receiver validation, report, or EVMClient.
  if (mode === "local-simulation") {
    const result = {
      mode: "local-simulation",
      candidates: candidates.map((h) => ({
        contract: h.contract,
        aura: h.aura,
      })),
      wouldWrite: candidates.length > 0,
    };
    runtime.log(`CRE local-simulation: ${JSON.stringify(result)}`);
    return JSON.stringify(result);
  }

  // Production: fail closed until the graduation consumer contract is deployed.
  const receiver = runtime.config.consumerAddress;
  if (!receiver || !isAddress(receiver) || receiver === zeroAddress) {
    throw new Error(
      "graduation consumerAddress missing/malformed/zero — deploy the consumer contract first",
    );
  }

  // One report carries the whole batch: the consumer graduates each handle.
  const handles = candidates.map((h) => h.contract as Address);
  const encoded = encodeAbiParameters(
    parseAbiParameters("address[] handles"),
    [handles],
  );
  const report = runtime.report(prepareReportRequest(encoded)).result();

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName,
  });
  if (!network) throw new Error(`unknown selector: ${chainSelectorName}`);
  const client = new EVMClient(network.chainSelector.selector);

  const write = client
    .writeReport(runtime, {
      receiver,
      report,
      gasConfig: { gasLimit: runtime.config.gasLimit ?? "1000000" },
    })
    .result();
  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(write.errorMessage ?? `write status ${write.txStatus}`);
  }
  if (!write.txHash) throw new Error("write succeeded without a transaction hash");

  const tx = bytesToHex(write.txHash);
  runtime.log(`CRE: graduated ${candidates.length} handles, tx ${tx}`);
  return JSON.stringify({
    mode: "production",
    graduated: candidates.length,
    txHash: tx,
  });
};

export const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCron)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
