/**
 * Friendly copy for the reverts that actually happen: balances, vault cash that
 * moved between preview and tx, orders already filled, slippage, closed windows.
 * Falls back to the raw message so nothing is hidden.
 *
 * Lives on its own (not in `lib/trade.ts`) because the error toast helper and the
 * trade executor both need it — importing the hooks module from the notifier
 * would make a cycle.
 */
function errMsg(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return "Transaction failed";
}

export function explainRevert(e: unknown): string {
  const raw = errMsg(e);
  const m = raw.toLowerCase();
  if (/user (rejected|denied)|rejected the request/.test(m)) return "You rejected the request";
  if (/exceeds balance|insufficient (funds|balance)|transfer amount exceeds/.test(m))
    return "Not enough balance for this transaction";
  if (/exceeds allowance|allowance/.test(m)) return "Approval missing — try again";
  if (/idle|reserve|insufficient cash/.test(m))
    return "Vault cash moved — try a smaller amount";
  if (/ledgershort/.test(m))
    return "The market can't cover this sale right now — try a smaller size";
  if (/insufficientshares/.test(m)) return "Not enough shares to sell";
  if (/not active|already (filled|cancelled)|order (filled|cancelled|missing)/.test(m))
    return "That order was already filled or cancelled";
  if (/minshares|minproceeds|slippage|price moved/.test(m))
    return "Price moved more than 5% — try again";
  if (/(not|window) (open|closed|ended)|settled/.test(m))
    return "This window has ended — settle or claim instead";
  if (/zero amount/.test(m)) return "Enter an amount";
  if (/reverted/.test(m)) return "The contract rejected this transaction";
  return raw;
}
