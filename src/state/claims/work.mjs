// Work coordination composes core item operations with the common-dir evidence store.
import { localDate } from "../../core/identity/date.mjs";
import { planSet } from "../../core/items/set.mjs";
import { mutateStore } from "../../core/items/transaction.mjs";
import { stopWork } from "../../core/items/content/stopped.mjs";
import { parseEntries } from "../../core/validation/check.mjs";
import { workingSnapshot } from "../../repository/snapshot.mjs";
import { sameKey } from "../../repository/canonical.mjs";
import { branchActivity, workBinding, worktreePath } from "../../repository/work-activity.mjs";
import { claimItem, readWork, withWorkLock } from "./store.mjs";

export function claimWork(ctx, id, options) {
  return claimItem(ctx.commonDir, id, {
    ...options,
    ...workBinding(ctx.root),
    enterWip: () =>
      mutateStore(ctx, (s) => planSet(s, id, { status: "wip" }, { today: localDate() })),
  });
}

export function activity(ctx, { ids = [], now = new Date() } = {}) {
  const work = readWork(ctx.commonDir);
  const items = parseEntries(workingSnapshot(ctx).entries)
    .filter((r) => r.fields?.status === "wip" && (!ids.length || ids.includes(r.id)))
    .map(({ id }) => {
      const binding = work[id];
      return {
        id,
        branch: binding?.branch ?? null,
        worktree: binding?.worktree ?? null,
        ...branchActivity(ctx.root, binding ? binding.branch : undefined, now),
      };
    });
  return { items };
}

export function releaseWorktree(ctx, p) {
  const target = worktreePath(p);
  return withWorkLock(ctx.commonDir, (work) => {
    const ids = Object.entries(work)
      .filter(
        ([, binding]) => typeof binding?.worktree === "string" && sameKey(binding.worktree, target),
      )
      .map(([id]) => id);
    return stopWork(ctx, ids, { today: localDate() });
  });
}
