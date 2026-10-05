// When Git first recorded each legacy entry: the earliest author date of a commit that added a line
// carrying the entry's `<!-- bl-... -->` marker, across the register and shard paths (including the
// pre-partition single-file backlog). A "recorded by" date, never presented as the real creation date.
import { tryGit, git } from "../../repository/context.mjs";

const MARKER_RE = /<!--\s*(bl-[0-9a-f]{8})\s*-->/g;

/** Map<bl-id, YYYY-MM-DD> of first-seen dates. Empty when the repo has no history. */
export function firstSeenDates(root, paths) {
  const seen = new Map();
  if (!tryGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"])) return seen;
  const log = git(root, ["log", "--no-renames", "--format=%x00%as", "-p", "-U0", "--", ...paths]);
  let date = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("\0")) {
      date = line.slice(1).trim();
      continue;
    }
    if (!date || !line.startsWith("+") || line.startsWith("+++")) continue;
    for (const m of line.matchAll(MARKER_RE)) {
      const prev = seen.get(m[1]);
      if (!prev || date < prev) seen.set(m[1], date);
    }
  }
  return seen;
}
