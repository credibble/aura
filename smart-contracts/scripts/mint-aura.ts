import { ethers } from "hardhat";
import { readFileSync } from "node:fs";

/**
 * Mint $AURA to a wallet so the per-handle Stake vaults can be exercised
 * (Stake takes AURA collateral, so a wallet with no AURA cannot use it).
 *
 *   PRIVATE_KEY=$RELAYER_PK ORACLE_PRIVATE_KEY=$RELAYER_PK \
 *     npx hardhat run scripts/mint-aura.ts --network monadTestnet
 *
 * Env (all optional):
 *   MINT_TO      recipient address   (default: the relayer in deployments.json)
 *   MINT_AMOUNT  whole AURA to hold  (default: 1000000)
 *   MINT_FORCE   "1" → mint MINT_AMOUNT again even if already funded
 *
 * Safe to re-run: by default this is a top-up — it mints only the shortfall, so
 * a second run with no spend mints nothing (never a silent double-mint). Set
 * MINT_FORCE=1 to deliberately mint the full amount once more.
 *
 * `AuraToken.mint(to, amount)` is `minter`-only; the minter is whoever deployed
 * the token (deployments.json `deployer`, which equals `relayer` in this deploy).
 * The script checks that on-chain before sending and refuses with a clear
 * message if our key is not the minter.
 */

async function main(): Promise<void> {
  const deployments = JSON.parse(readFileSync("deployments/deployments.json", "utf8"));
  const [deployer] = await ethers.getSigners();
  const relayerPk = process.env.ORACLE_PRIVATE_KEY;
  const relayer = relayerPk ? new ethers.Wallet(relayerPk, ethers.provider) : deployer;

  const aura = await ethers.getContractAt("AuraToken", deployments.auraToken);
  const to: string = process.env.MINT_TO ?? relayer.address;
  const amount = ethers.parseUnits(process.env.MINT_AMOUNT ?? "1000000", 18);
  const force = process.env.MINT_FORCE === "1";

  console.log(`\nAuraToken  ${deployments.auraToken}`);
  console.log(`Signer     ${relayer.address}`);
  console.log(`Recipient  ${to}`);
  console.log(`Target     ${ethers.formatUnits(amount, 18)} AURA\n`);

  // AuraToken.minter is immutable, set to the constructor caller.
  const minter: string = await aura.minter();
  console.log(`On-chain minter  ${minter}`);

  const before: bigint = await aura.balanceOf(to);
  console.log(`Balance before   ${ethers.formatUnits(before, 18)} AURA`);

  if (minter.toLowerCase() !== relayer.address.toLowerCase()) {
    throw new Error(
      `minting not permitted: AuraToken.minter is ${minter}, but the signer is ` +
        `${relayer.address}. Only the deployer (${deployments.deployer}) may mint — ` +
        `run this with that key, or fund the Stake vaults from it.`,
    );
  }

  const shortfall = amount > before ? amount - before : 0n;
  const mintAmount = force ? amount : shortfall;

  if (mintAmount === 0n) {
    console.log(
      `\nAlready funded (>= ${ethers.formatUnits(amount, 18)} AURA) — nothing minted. ` +
        `Set MINT_FORCE=1 to mint the full amount again.`,
    );
    return;
  }

  const mode = force
    ? "MINT_FORCE=1 — minting the full amount"
    : `top-up — minting the ${ethers.formatUnits(shortfall, 18)} AURA shortfall`;
  const tx = await aura.connect(relayer).mint(to, mintAmount);
  const receipt = await tx.wait();
  console.log(`\n${mode}\nMint tx  ${receipt?.hash}`);

  const after: bigint = await aura.balanceOf(to);
  const delta = after - before;
  console.log(`Balance after    ${ethers.formatUnits(after, 18)} AURA  (read-back)`);
  console.log(`Delta            ${ethers.formatUnits(delta, 18)} AURA`);
  if (delta !== mintAmount) {
    throw new Error(`read-back mismatch: expected +${mintAmount}, saw +${delta}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
