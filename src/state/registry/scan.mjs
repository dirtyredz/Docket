// One-shot discovery: walk a directory for Docket checkouts (a Git checkout root holding docket.json)
// and merge them into the registry. Additive only: never initialises, imports, watches or prunes.
// Discovery runs before the registry lock; merging runs under it against the latest registry.
import fs from "node:fs";
import path from "node:path";
import { canonicalPath, sameKey } from "../../repository/canonical.mjs";
import { toSlash } from "../../repository/paths.mjs";
import {
  aliasFrom,
  aliasTaken,
  createGroup,
  findRepoByCommonDir,
  inspectCheckout,
  joinGroup,
} from "./registration.mjs";

/**
 * Directory names never descended into, never reported: Git internals, Docket state, dependency trees
 * and build/output folders (thousands of generated directories, never a checkout root). Gitignore-based
 * skipping is deliberately not used: `.claude/worktrees/` is routinely ignored yet holds real checkouts.
 * `bin`/`obj` are not listed because they are plausible project folder names.
 */
export const SKIP_DIRS = new Set([
  ".git",
  ".docket",
  "node_modules",
  "bower_components",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".cache",
  "target",
]);
export const MAX_DEPTH = 12;

/**
 * Walk `dir` (bounded by maxDepth). Returns {root, candidates: [{root, commonDir, main}], skipped:
 * [{path, reason}]}. Descends into a found checkout too, so nested repos and `.claude/worktrees/`
 * are found. Directory links and junctions are reported, never followed.
 */
export function scanForRepos(dir, { maxDepth = MAX_DEPTH } = {}) {
  const root = canonicalPath(dir);
  const candidates = [];
  const skipped = [];
  const walk = (current, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      skipped.push({ path: current, reason: `inaccessible (${err.code ?? err.message})` });
      return;
    }
    if (entries.some((e) => e.name === "docket.json" && e.isFile())) {
      consider(current);
    }
    for (const e of entries) {
      const child = `${current}/${e.name}`;
      if (e.isSymbolicLink()) {
        let target = null;
        try {
          target = fs.statSync(child).isDirectory();
        } catch {
          /* dangling */
        }
        if (target !== false)
          skipped.push({ path: child, reason: "directory link (not followed)" });
        continue;
      }
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      if (depth >= maxDepth) {
        skipped.push({ path: child, reason: `depth limit ${maxDepth}` });
        continue;
      }
      walk(child, depth + 1);
    }
  };
  const consider = (current) => {
    let info;
    try {
      info = inspectCheckout(current);
    } catch (err) {
      skipped.push({ path: current, reason: `docket.json but not usable: ${err.message}` });
      return;
    }
    if (!sameKey(info.root, current)) {
      skipped.push({ path: current, reason: `docket.json below the checkout root ${info.root}` });
      return;
    }
    candidates.push(info);
  };
  walk(root, 0);
  return { root, candidates, skipped };
}

/** A free alias for a new group: the directory name, else name-parent, else name-2, name-3, ... */
function disambiguate(registry, info) {
  const base = aliasFrom(path.basename(info.root));
  if (!aliasTaken(registry, base)) return { alias: base };
  const parent = aliasFrom(path.basename(path.dirname(info.root)));
  let alias = aliasFrom(`${base}-${parent}`);
  for (let n = 2; aliasTaken(registry, alias); n++) alias = `${base}-${n}`;
  return { alias, reason: `"${base}" is taken; registered as "${alias}"` };
}

const byPath = (a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0);

/**
 * Merge scan candidates into `registry` (mutated). Candidates are grouped by common directory; an
 * existing group keeps its alias, preferred checkout and overrides and only gains new checkouts. A new
 * group prefers its main checkout when found. Returns {repos: [{id, alias, change, checkouts, added}],
 * aliases: [{alias, reason}]}; change is created | joined | unchanged.
 */
export function mergeDiscovered(registry, found) {
  const groups = new Map();
  for (const c of [...found.candidates].sort(byPath)) {
    const key = toSlash(c.commonDir).toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const repos = [];
  const aliases = [];
  const ordered = [...groups.values()].sort((a, b) => byPath(a[0], b[0]));
  for (const members of ordered) {
    const main = members.find((m) => m.main) ?? members[0];
    let repo = findRepoByCommonDir(registry, main.commonDir);
    if (!repo) {
      const { alias, reason } = disambiguate(registry, main);
      if (reason) aliases.push({ alias, reason });
      const paths = [main.root, ...members.filter((m) => m !== main).map((m) => m.root)];
      ({ repo } = createGroup(registry, main, alias, paths));
      repos.push(summary(repo, "created", paths));
      continue;
    }
    const added = [];
    for (const m of members) {
      if (repo.checkouts.some((c) => sameKey(c.path, m.root))) continue;
      joinGroup(registry, repo, m.root);
      added.push(m.root);
    }
    repos.push(summary(repo, added.length ? "joined" : "unchanged", added));
  }
  return { repos, aliases };
}

const summary = (repo, change, added) => ({
  id: repo.id,
  alias: repo.alias,
  change,
  checkouts: repo.checkouts.map((c) => c.path),
  added,
});
