// Advisory worktree and claim hints for one logical repo: every Git worktree of the clone, whether it is
// a registered (and therefore selectable) checkout, and the advisory claims held there. Observations
// only, stamped with their time; nothing here is an edit target or owns any mutation rule.
import { sameKey } from "../../repository/canonical.mjs";
import { listWorktrees } from "../../repository/worktrees.mjs";
import { readClaims } from "../../state/claims/store.mjs";

/** Hints for `repo`, read through the opened checkout `ctx` (claims via the Git common dir only). */
export function worktreeHints(repo, ctx) {
  const { claims } = readClaims(ctx.commonDir);
  const claimList = Object.entries(claims).map(([id, c]) => ({ id, ...c }));
  const worktrees = listWorktrees(ctx.root).map((w) => {
    const registered = repo.checkouts.find((c) => sameKey(c.path, w.path)) ?? null;
    return {
      path: w.path,
      branch: w.branch,
      detached: w.detached,
      exists: w.exists,
      main: w.main,
      checkoutId: registered?.id ?? null,
      preferred: registered?.id === repo.preferred,
      claims: claimList.filter((c) => sameKey(c.worktree, w.path)),
    };
  });
  return { observedAt: new Date().toISOString(), advisory: true, worktrees };
}
