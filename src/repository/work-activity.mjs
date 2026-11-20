// Git evidence for retained work bindings; reads never update a binding or a cache.
import path from "node:path";
import { canonicalPath } from "./canonical.mjs";
import { currentBranch, tryGit } from "./context.mjs";
import { toSlash } from "./paths.mjs";

export function workBinding(root) {
  return { worktree: canonicalPath(root), branch: currentBranch(root) };
}

/** Resolve existing ancestors too: release is also called after a worktree was removed. */
export function worktreePath(p) {
  try {
    return canonicalPath(p);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    const absolute = path.resolve(p);
    const parent = path.dirname(absolute);
    if (parent === absolute) throw err;
    return toSlash(path.join(worktreePath(parent), path.basename(absolute)));
  }
}

export function branchActivity(root, branch, now = new Date()) {
  const unknown = (unknownReason) => ({ lastCommitAt: null, quietDays: null, unknownReason });
  if (branch === null) return unknown("detached");
  if (typeof branch !== "string" || !branch) return unknown("unrecorded");
  const ref = branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
  const stamp = tryGit(root, ["log", "-1", "--format=%cI", ref, "--"]);
  if (!stamp) return unknown("missing-ref");
  const time = Date.parse(stamp);
  if (!Number.isFinite(time)) return unknown("invalid-commit-time");
  return {
    lastCommitAt: new Date(time).toISOString(),
    quietDays: Math.max(0, Math.floor((now.getTime() - time) / 86400000)),
    unknownReason: null,
  };
}
