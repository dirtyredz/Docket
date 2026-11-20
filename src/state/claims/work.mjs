// Work coordination composes core item operations with the common-dir evidence store.
import { localDate } from "../../core/identity/date.mjs";
import { planSet } from "../../core/items/set.mjs";
import { mutateStore } from "../../core/items/transaction.mjs";
import { stopWork } from "../../core/items/content/stopped.mjs";
import { parseEntries } from "../../core/validation/check.mjs";
import { workingSnapshot } from "../../repository/snapshot.mjs";
import { sameKey } from "../../repository/canonical.mjs";
import { branchActivity, workBinding, worktreePath } from "../../repository/work-activity.mjs";
import {
  buildClaim,
  readClaims,
  readWork,
  recordBinding,
  releaseItem,
  withWorkLock,
  write,
} from "./store.mjs";

/** Persist bindings after item writes; a failure here is partial when items were already saved. */
function saveAfterItems(commonDir, claims, work, written) {
  try {
    write(commonDir, claims, work);
  } catch (err) {
    if (written.length) {
      err.message = `items saved, but work bindings were not saved: ${err.message}`;
      Object.assign(err, { partial: true, written });
    }
    throw err;
  }
}

/** Claim `id` and enter WIP in one common-dir lock; the binding is saved after the item write. */
export function claimWork(ctx, id, options) {
  return withWorkLock(ctx.commonDir, (work) => {
    const { claims } = readClaims(ctx.commonDir);
    const result = buildClaim(claims, id, { ...options, ...workBinding(ctx.root) });
    const entered = mutateStore(ctx, (s) =>
      planSet(s, id, { status: "wip" }, { today: localDate() }),
    );
    recordBinding(work, [id], { worktree: result.claim.worktree, branch: result.claim.branch });
    saveAfterItems(ctx.commonDir, claims, work, entered?.written ?? []);
    return result;
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

/** Apply an item plan and record only newly entered WIP, including batch additions. */
export function mutateWorkStore(ctx, plan) {
  return withWorkLock(ctx.commonDir, (work) => {
    const binding = workBinding(ctx.root);
    const entered = new Set();
    let result;
    try {
      result = mutateStore(ctx, (store) => {
        const planned = plan(store);
        for (const w of planned.writes) {
          if (w.fields.status === "wip" && store.byId.get(w.id)?.fields?.status !== "wip") {
            entered.add(w.id);
          }
        }
        return planned;
      });
    } catch (err) {
      const written = err.written ?? [];
      const kept = written.filter(({ id }) => entered.has(id)).map(({ id }) => id);
      if (kept.length) {
        recordBinding(work, kept, binding);
        saveAfterItems(ctx.commonDir, readClaims(ctx.commonDir).claims, work, written);
      }
      throw err;
    }
    if (entered.size) {
      recordBinding(work, entered, binding);
      saveAfterItems(ctx.commonDir, readClaims(ctx.commonDir).claims, work, result.written);
    }
    return result;
  });
}

/** Opaque claims dependency for the item operations (readItem, setItem, ...); pass it as `claims`. */
export const workClaims = { readClaims, releaseItem, mutateWorkStore };
