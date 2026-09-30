/**
 * Configurator → the singleton `Config` entity: every owner update keeps the
 * index in sync with the on-chain tunables (fee curve, window rules).
 */
import { indexer, type Entity } from "envio";
import type { Ctx } from "../lib/helpers";

const ID = "config";

async function config(context: Ctx): Promise<Entity<"Config">> {
  const existing = await context.Config.get(ID);
  if (existing) return existing;
  return {
    id: ID,
    depositFeeMinBps: 0,
    depositFeeMaxBps: 0,
    maxFeeAura: 0n,
    marketFeeBps: 0,
    minWindowSeconds: 0n,
    windowPadding: 0n,
  };
}

indexer.onEvent({ contract: "Configurator", event: "DepositFeeRangeSet" }, async ({ event, context }) => {
  const current = await config(context);
  context.Config.set({
    ...current,
    depositFeeMinBps: Number(event.params.minBps),
    depositFeeMaxBps: Number(event.params.maxBps),
  });
});

indexer.onEvent({ contract: "Configurator", event: "MaxFeeAuraSet" }, async ({ event, context }) => {
  const current = await config(context);
  context.Config.set({ ...current, maxFeeAura: event.params.maxFeeAura });
});

indexer.onEvent({ contract: "Configurator", event: "MarketFeeBpsSet" }, async ({ event, context }) => {
  const current = await config(context);
  context.Config.set({ ...current, marketFeeBps: Number(event.params.bps) });
});

indexer.onEvent({ contract: "Configurator", event: "MinWindowSecondsSet" }, async ({ event, context }) => {
  const current = await config(context);
  context.Config.set({ ...current, minWindowSeconds: event.params.minWindowSeconds });
});

indexer.onEvent({ contract: "Configurator", event: "WindowPaddingSet" }, async ({ event, context }) => {
  const current = await config(context);
  context.Config.set({ ...current, windowPadding: event.params.windowPadding });
});
