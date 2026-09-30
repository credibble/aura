/**
 * Aura handle-graduation Chainlink CRE workflow.
 *
 * A cron-triggered workflow that graduates handles once they clear the aura
 * bar: on schedule it queries the Aura subgraph for handles that are NOT yet
 * graduated but have `aura > minGraduationAura` (1e2-scaled; 1000 = 10.00),
 * then calls `Handle.setGraduated(true)` on each candidate with the protocol
 * signer. That signer must be the handle's `auraUpdater` (the oracle relayer)
 * or the HandleFactory owner — `setGraduated` is `onlyProtocol`.
 *
 * Built with the CRE SDK (code-first, compiled to WASM by the `cre` CLI):
 *   cre workflow build ./graduation --target staging-settings
 *   cre workflow simulate aura-graduation-staging --target staging-settings
 *   cre workflow deploy aura-graduation-production --target production-settings
 */
import { CronCapability, HttpCapability, handler, Runner, type Runtime } from "@chainlink/cre-sdk";

type Config = {
  /** Cron schedule (every 15 minutes by default). */
  schedule: string;
  /** The Aura subgraph GraphQL endpoint. */
  subgraphUrl: string;
  /** Aura floor (1e2-scaled) — graduate handles strictly above this (1000 = 10.00). */
  minGraduationAura: string;
};

const HANDLE_ABI = ["function setGraduated(bool graduated)"] as const;

const GRADUATION_QUERY = `
  query($minAura: BigInt!, $first: Int) {
    handles(
      where: { graduated: false, aura_gt: $minAura }
      orderBy: aura
      orderDirection: desc
      first: $first
    ) {
      contract
      aura
    }
  }
`;

const onCron = (runtime: Runtime<Config>): string => {
  const { subgraphUrl, minGraduationAura } = runtime.config;
  const evm = runtime.evm;

  // Query the subgraph for handles that cleared the aura bar but aren't
  // graduated yet — a consensus-verified HTTP read of the indexed chain state.
  const response = new HttpCapability()
    .request(runtime, {
      method: "POST",
      url: subgraphUrl,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: GRADUATION_QUERY,
        variables: { minAura: minGraduationAura, first: 100 },
      }),
    })
    .result();

  let candidates: { contract: string; aura: string }[] = [];
  try {
    candidates = JSON.parse(response).data.handles;
  } catch {
    runtime.log(`CRE: subgraph response not parseable — skipping run`);
    return "graduation-skip";
  }

  runtime.log(`CRE: ${candidates.length} handles with aura > ${minGraduationAura} to graduate`);

  for (const handle of candidates) {
    evm
      .writeContract(runtime, {
        address: handle.contract,
        abi: HANDLE_ABI,
        functionName: "setGraduated",
        args: [true],
      })
      .result();
    runtime.log(`CRE: graduated ${handle.contract} (aura ${handle.aura})`);
  }

  return "graduation-complete";
};

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCron)];
};

export async function main(): Promise<void> {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}