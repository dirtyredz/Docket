// Validate a store as one operation: pick the snapshot (working tree, or the items committed at a
// Git ref), learn which items are claimed, run the checks. Shared by the CLI, the pre-push gate and
// import apply. Claims are an optional dependency; without them the unclaimed-wip warning is skipped.
import { localDate } from "../identity/date.mjs";
import { refSnapshot, workingSnapshot } from "../../repository/snapshot.mjs";
import { checkSnapshot } from "./check.mjs";

/**
 * options: {ref?, today?, claims?: {readClaims}}. Returns checkSnapshot's result
 * ({ok, source, count, errors, warnings, records}).
 */
export function checkStore(ctx, { ref = null, today = localDate(), claims = null } = {}) {
  const snapshot = ref ? refSnapshot(ctx, ref) : workingSnapshot(ctx);
  const claimedIds = claims ? new Set(Object.keys(claims.readClaims(ctx.commonDir).claims)) : null;
  return checkSnapshot(snapshot, { today, claimedIds });
}
