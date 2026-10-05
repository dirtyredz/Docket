// `set` as the CLI and viewer run it: plan and write the change, then, when it completes the item,
// release the item's claim. Claims are a dependency (`claims.releaseItem`), not an import, so core
// stays free of the coordination store. A cleanup failure is a warning, never a failed write.
import { planSet } from "./set.mjs";
import { mutateStore, withWritten } from "./transaction.mjs";

/** Remove the claim on a completed item; report (never throw) when that fails. */
function cleanupClaim(ctx, id, claims) {
  try {
    const { released } = claims.releaseItem(ctx.commonDir, id, { worktree: ctx.root, force: true });
    return { claimReleased: released, warnings: [] };
  } catch (err) {
    return {
      claimReleased: false,
      warnings: [
        { file: `${id}.md`, message: `item saved, but its claim was not removed: ${err.message}` },
      ],
    };
  }
}

/**
 * Apply a set. changes as planSet; options: {today, expect?, claims: {releaseItem}}.
 * Returns {data, warnings}: data is planSet's value plus {revision, noop} and, for a completion,
 * `claimReleased`.
 */
export function setItem(ctx, id, changes, { today, expect, claims }) {
  const data = withWritten(mutateStore(ctx, (s) => planSet(s, id, changes, { today, expect })));
  const cleanup = data.completed ? cleanupClaim(ctx, id, claims) : { warnings: [] };
  if (data.completed) data.claimReleased = cleanup.claimReleased;
  return { data, warnings: cleanup.warnings };
}
