/**
 * `OracleFactory.OracleDeployed` — the window exists from the moment its oracle
 * does, which is what every later MarketMaker/Pool event resolves against.
 *
 * The window's question/style/strike arrive with `WindowOpened` (the
 * MarketMaker's own event, same transaction), so there is nothing to read here.
 */
import { indexer } from "envio";
import { blankWindow, loadOrCreateHandle, windowId } from "../lib/helpers";

indexer.onEvent({ contract: "OracleFactory", event: "OracleDeployed" }, async ({ event, context }) => {
  const handleId = event.params.handleId.toLowerCase();
  const oracle = event.params.oracle.toLowerCase();
  const handle = await loadOrCreateHandle(context, handleId, true);
  const id = windowId(handleId, event.params.windowStart);

  const existing = await context.Window.get(id);
  const isNew = existing === undefined;
  const win = existing ?? blankWindow(id, handleId, event.params.windowStart, handle.id);

  context.Window.set({ ...win, oracle });
  if (isNew) {
    context.Handle.set({ ...handle, windowCount: handle.windowCount + 1 });
  }
  context.OracleWindow.set({ id: oracle, window_id: id });
});
