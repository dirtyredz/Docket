// Git worktree enumeration: every worktree of one clone, from `git worktree list --porcelain`.
import { git } from "./context.mjs";
import { tryCanonicalPath } from "./canonical.mjs";
import { toSlash } from "./paths.mjs";

/**
 * Worktrees of the clone containing `root`: [{path, exists, head, branch, detached, bare, prunable,
 * main}]. `path` is canonical when it exists; the first entry is the main worktree.
 */
export function listWorktrees(root) {
  const out = git(root, ["worktree", "list", "--porcelain"]);
  const trees = [];
  let cur = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      const raw = toSlash(line.slice(9));
      const real = tryCanonicalPath(raw);
      cur = { path: real ?? raw, exists: Boolean(real), head: null, branch: null };
      cur.detached = false;
      cur.bare = false;
      cur.prunable = false;
      cur.main = trees.length === 0;
      trees.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith("HEAD ")) cur.head = line.slice(5);
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "detached") cur.detached = true;
    else if (line === "bare") cur.bare = true;
    else if (line.startsWith("prunable")) cur.prunable = true;
  }
  return trees;
}
