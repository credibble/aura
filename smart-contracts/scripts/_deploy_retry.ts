/**
 * TEMPORARY (untracked) runner — not part of the repo's normal flow.
 *
 * Hardhat signs each tx locally using a nonce it reads from
 * `eth_getTransactionCount(from, "pending")`. The deploy scripts broadcast many
 * txs back-to-back (contract deployments resolve on broadcast, not mining), so
 * against a load-balanced RPC two sends can read the same pending nonce and the
 * node rejects the second with "An existing transaction had higher priority".
 *
 * This wrapper installs itself on the Hardhat network provider and:
 *   1. waits for each sent tx's receipt before returning (serialises sends, so
 *      the next nonce read always reflects a mined tx),
 *   2. re-submits a tx whose hash was returned but never landed (Monad drops),
 *      and
 *   3. retries the transient priority/timeout errors.
 *
 * It then runs the target script (env TARGET, default ./deploy.ts) unchanged.
 */
import hre from "hardhat";
import { setTimeout as sleep } from "node:timers/promises";

const provider: any = hre.network.provider;
const rawRequest: (args: { method: string; params?: any[] }) => Promise<any> =
  provider.request.bind(provider);

const RETRYABLE =
  /higher priority|already known|nonce too low|replacement transaction|timeout|ECONNRESET|socket hang up|fetch failed|429|Too Many Requests|502|503|504/i;

async function receiptOf(hash: string): Promise<any | null> {
  try {
    return await rawRequest({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
  } catch {
    return null;
  }
}

async function waitMined(hash: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await receiptOf(hash)) return true;
    await sleep(300);
  }
  return false;
}

async function txKnown(hash: string): Promise<boolean> {
  try {
    return Boolean(
      await rawRequest({ method: "eth_getTransactionByHash", params: [hash] }),
    );
  } catch {
    return false;
  }
}

async function sendAndConfirm(method: string, params?: any[]): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      let res = await rawRequest({ method, params });
      if (method !== "eth_sendTransaction" || typeof res !== "string") {
        return res;
      }
      // Serialise: confirm this tx is mined before the caller sends the next,
      // so the next nonce read is always fresh.
      for (let round = 0; round < 6; round++) {
        if (await waitMined(res, 60_000)) return res;
        if (await txKnown(res)) continue; // known but slow — keep waiting
        console.error(`[resubmit] ${res} never landed; re-sending`);
        const again = await rawRequest({ method, params });
        if (typeof again === "string") res = again;
      }
      throw new Error(`tx ${res} never mined after repeated resubmits`);
    } catch (e: any) {
      const msg = `${e?.message ?? e} ${String(e?.data ?? "")}`;
      if (attempt >= 15 || !RETRYABLE.test(msg)) throw e;
      console.error(`[retry ${attempt + 1}] ${method}: ${e?.message ?? e}`);
      await sleep(1500 + attempt * 1000);
    }
  }
}

provider.request = (args: any) => sendAndConfirm(args?.method, args?.params);
if (typeof provider.send === "function") {
  provider.send = (method: string, params?: any[]) => sendAndConfirm(method, params);
}
console.log("[runner] installed serialise+retry+resubmit provider wrapper");

const target = process.env.TARGET ?? "./deploy.ts";
console.log(`[runner] running ${target}\n`);
// eslint-disable-next-line @typescript-eslint/no-var-requires
require(target);
