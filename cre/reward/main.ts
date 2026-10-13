/**
 * Aura stake-rewarding Chainlink CRE workflow.
 *
 * A cron-triggered workflow that rewards each handle's stakers: on schedule it
 * reads every handle's Stake vault from the Envio indexer (the HyperSync-synced
 * chain index the app and the oracle already read) — both the list of vaults
 * AND their current AURA balance come from one indexed query — decides which
 * vaults have dipped below the target, and delivers ONE consensus-signed report
 * to the reward consumer contract on Monad testnet, which then approves AURA and
 * calls `Stake.reward(amount, memo)` for each underfunded vault.
 *
 * CRE's write model: the workflow never calls Stake/Aura directly. It ABI-encodes
 * the batch payload, generates a signed report (`runtime.report`), and delivers it
 * through the chain's Keystone Forwarder via `EVMClient.writeReport` to the
 * consumer's `onReport`, which performs the on-chain calls.
 *
 * Reads go through Envio (HyperSync primary, HyperRPC fallback underneath),
 * never a raw RPC scan: `Stake.totalAssets` is exactly `aura.balanceOf(vault)`
 * (Stake.sol totalAssets) and the indexer refreshes it on every
 * `StakeStateChanged`. The HTTP read is consensus-aggregated across DON nodes.
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
  /** Cron schedule (6-hourly by default). */
  schedule: string;
  /** CRE chain selector name — `monad-testnet` (the only target). */
  chainSelectorName: string;
  /** The Envio indexer GraphQL endpoint — HyperSync-backed, `/v1/graphql`. */
  indexerUrl: string;
  /** Amount (wei) to reward each underfunded stake vault per run. */
  rewardAmount: string;
  /** Skip a vault when its indexed AURA balance is already above this (wei). */
  skipIfBalanceAbove: string;
  /** Local-simulation discriminator; production configs must NOT set this. */
  mode?: "local-simulation";
  /** The deployed reward consumer contract on Monad testnet (production only). */
  consumerAddress?: string;
  /** uint64 gas limit (decimal string) for the report delivery (production only). */
  gasLimit?: string;
};

type IndexedStake = {
  id: string;
  totalAssets: string;
  // optional (not `| null`) so the whole value stays CreSerializable for
  // identical consensus aggregation — `null` is non-serializable.
  handle?: { name?: string };
};

/**
 * Every per-handle stake vault plus its live AURA balance, straight from the
 * index — Envio's own dialect (`order_by`, `_eq`-style filters), the same
 * shape the app's `queries/stake.ts` uses. `Stake.totalAssets` ≡
 * `aura.balanceOf(vault)`.
 */
const STAKES_QUERY = `
  query($limit: Int) {
    Stake(limit: $limit, order_by: { id: asc }) {
      id
      totalAssets
      handle { name }
    }
  }
`;

/**
 * One consensus-verified HTTP read of the HyperSync-backed index, run
 * independently on every DON node. The POST body is protobuf bytes as base64.
 */
const fetchStakes = (
  sender: HTTPSendRequester,
  url: string,
  limit: number,
): IndexedStake[] => {
  const body = bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({ query: STAKES_QUERY, variables: { limit } }),
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
  const parsed = json(response) as { data?: { Stake?: IndexedStake[] } };
  if (!Array.isArray(parsed?.data?.Stake))
    throw new Error("indexer response missing Stake[]");
  return parsed.data.Stake;
};

export const onCron = (runtime: Runtime<Config>): string => {
  const {
    indexerUrl,
    chainSelectorName,
    rewardAmount,
    skipIfBalanceAbove,
    mode,
  } = runtime.config;
  const skipAbove = BigInt(skipIfBalanceAbove);
  const amount = BigInt(rewardAmount);

  // Real consensus fetch — every DON node queries the live index.
  const stakes = new HTTPClient()
    .sendRequest(
      runtime,
      fetchStakes,
      consensusIdenticalAggregation<IndexedStake[]>(),
    )(indexerUrl, 200)
    .result();

  if (stakes.length === 0) {
    runtime.log("CRE: indexer returned no stake vaults — nothing to do");
    return JSON.stringify({
      mode: mode ?? "production",
      rewarded: 0,
      note: "no-vaults",
    });
  }

  const underfunded = stakes.filter(
    (s) => BigInt(s.totalAssets) < skipAbove,
  );
  runtime.log(
    `CRE: ${stakes.length} vaults, ${underfunded.length} underfunded (< ${skipIfBalanceAbove})`,
  );

  // One report = one on-chain tx. Cap the batch so the consumer's loop stays
  // well inside the report gas budget (config `gasLimit`); the remainder is
  // picked up by the next run.
  const MAX_BATCH = 100;
  const batch = underfunded.slice(0, MAX_BATCH);
  if (underfunded.length > batch.length) {
    runtime.log(
      `CRE: capping batch ${underfunded.length} → ${batch.length} (next run takes the rest)`,
    );
  }

  // Receiver-free local simulation: real read + decision, then a labeled result
  // and an early return — no receiver validation, report, or EVMClient.
  if (mode === "local-simulation") {
    const result = {
      mode: "local-simulation",
      totalVaults: stakes.length,
      underfunded: underfunded.map((s) => ({
        stake: s.id,
        totalAssets: s.totalAssets,
        handle: s.handle?.name ?? null,
      })),
      wouldWrite: underfunded.length > 0,
      rewardAmount,
    };
    runtime.log(`CRE local-simulation: ${JSON.stringify(result)}`);
    return JSON.stringify(result);
  }

  // Production: fail closed until the reward consumer contract is deployed.
  const receiver = runtime.config.consumerAddress;
  if (!receiver || !isAddress(receiver) || receiver === zeroAddress) {
    throw new Error(
      "reward consumerAddress missing/malformed/zero — deploy the consumer contract first",
    );
  }
  if (underfunded.length === 0) {
    runtime.log("CRE: all vaults funded — no write due");
    return JSON.stringify({ mode: "production", rewarded: 0 });
  }

  // One report carries the whole batch: the consumer approves + rewards each.
  const targets = batch.map((s) => s.id as Address);
  const encoded = encodeAbiParameters(
    parseAbiParameters("address[] stakes, uint256 amount"),
    [targets, amount],
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
  runtime.log(
    `CRE: rewarded ${batch.length} vaults, tx ${tx}`,
  );
  return JSON.stringify({ mode: "production", rewarded: batch.length, txHash: tx });
};

export const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCron)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
