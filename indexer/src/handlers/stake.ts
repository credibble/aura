/**
 * A handle's Stake receipt (AURA LP). The receipt's own state arrives as
 * `StakeStateChanged` after every deposit/withdraw/reward, so the live Stake row
 * and its historical snapshot both come from the log — no reads.
 *
 * Only stakes created through HandleFactory are tracked (the entity must exist).
 */
import { indexer } from "envio";

indexer.onEvent({ contract: "Stake", event: "StakeStateChanged" }, async ({ event, context }) => {
  const stake = await context.Stake.get(event.srcAddress);
  if (!stake) return;

  const { totalSupply, totalAssets, valuePerToken } = event.params;
  context.Stake.set({ ...stake, totalSupply, totalAssets, valuePerToken });

  context.StakeSnapshot.set({
    id: `${event.srcAddress}-${event.block.number}-${event.logIndex}`,
    stake_id: stake.id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    totalSupply,
    totalAssets,
    valuePerToken,
  });
});
