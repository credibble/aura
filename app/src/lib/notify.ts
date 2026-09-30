import { toast } from "sonner";
import { explainRevert } from "@/lib/revert-copy";

/**
 * ONE error toast for the whole app.
 *
 * Before this, the same failure read three different ways depending on the
 * surface: raw `toast.error(e.message)` (developer copy), `toast.error("Transaction
 * failed", { description: explainRevert(e) })` (generic title, real reason hidden
 * in the detail), and `toast.error(explainRevert(e), { description: "Transaction
 * not confirmed" })` — which claimed "not confirmed" even when the chain had
 * *reverted*. Specific reason first, action context second.
 */
export function notifyError(error: unknown, action?: string): void {
  const reason = explainRevert(error);
  toast.error(reason, {
    description: action ? `${action} failed` : undefined,
  });
}
