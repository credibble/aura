import { ethers } from "hardhat";
import { readFileSync } from "node:fs";

/**
 * Post-deploy wiring check — read-only, no gas.
 *
 *   npx hardhat run scripts/verify-deploy.ts --network monadTestnet
 *
 * Proves the invariants settlement depends on:
 *   1. `OracleFactory.signer` == the relayer that signs resolution receipts
 *      (ORACLE_PRIVATE_KEY). If these differ, `submitResolution` reverts on
 *      every window and the whole market flow stalls silently.
 *   2. `OracleFactory.market` == the deployed MarketMaker (else the factory's
 *      one-shot `setMarket` was wired to a stale market).
 *   3. `MarketMaker.collateral` == the deployed USDC.
 *   4. `HandleFactory` is owned by the deployer/relayer.
 *   5. The seeded handles exist on-chain with the expected aura/graduation.
 */
async function main(): Promise<void> {
  const d = JSON.parse(readFileSync("deployments/deployments.json", "utf8"));
  const relayerPk = process.env.ORACLE_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  const relayer = relayerPk ? new ethers.Wallet(relayerPk).address : d.relayer;

  const of = await ethers.getContractAt("OracleFactory", d.oracleFactory);
  const mm = await ethers.getContractAt("MarketMaker", d.marketMaker);
  const hf = await ethers.getContractAt("HandleFactory", d.handleFactory);

  const signer: string = await of.signer();
  const market: string = await of.market();
  const registry: string = await of.registry();
  const collateral: string = await mm.collateral();
  const owner: string = await hf.owner();

  const rows: [string, string, string, boolean][] = [
    ["OracleFactory.signer == relayer", signer, relayer, signer.toLowerCase() === relayer.toLowerCase()],
    ["OracleFactory.market == MarketMaker", market, d.marketMaker, market.toLowerCase() === d.marketMaker.toLowerCase()],
    ["OracleFactory.registry == MarketRegistry", registry, d.marketRegistry, registry.toLowerCase() === d.marketRegistry.toLowerCase()],
    ["MarketMaker.collateral == USDC", collateral, d.usdc, collateral.toLowerCase() === d.usdc.toLowerCase()],
    ["HandleFactory.owner == relayer", owner, relayer, owner.toLowerCase() === relayer.toLowerCase()],
  ];

  let bad = 0;
  for (const [label, got, want, ok] of rows) {
    if (!ok) bad += 1;
    console.log(`${ok ? "  ok  " : " FAIL "} ${label}\n         got ${got}\n        want ${want}`);
  }

  for (const [name, h] of Object.entries(d.handles ?? {}) as [string, any][]) {
    const handle = await ethers.getContractAt("Handle", h.contract);
    const aura: bigint = await handle.aura();
    const graduated: boolean = await handle.graduated();
    const ok = Number(aura) === h.aura && graduated === h.graduated;
    if (!ok) bad += 1;
    console.log(
      `${ok ? "  ok  " : " FAIL "} handle @${name}: aura ${Number(aura) / 100} (want ${h.aura / 100}), graduated ${graduated}`,
    );
  }

  console.log(bad === 0 ? "\nAll deployment invariants hold.\n" : `\n${bad} invariant(s) FAILED.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
