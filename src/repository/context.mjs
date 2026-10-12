// Worktree and common-dir discovery, and the checkout context core operations take. Everything that asks
// "which checkout is this?" goes through here: resolveRepo discovers the enclosing checkout (the CLI's
// --repo), contextAtRoot accepts only an exact checkout root (headless consumers), contextFor builds the
// context from facts a caller has already verified.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { CODES, docketError } from "../core/errors.mjs";
import { canonicalPath, sameKey } from "./canonical.mjs";
import { ITEMS_DIR, toSlash } from "./paths.mjs";

/** Run git and return stdout (utf8 string, or a Buffer when `encoding: "buffer"`). Throws with stderr. */
export function git(cwd, args, { input, encoding = "utf8" } = {}) {
  try {
    const out = execFileSync("git", args, {
      cwd,
      input,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    return encoding === "buffer" ? out : out.toString(encoding);
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString("utf8").trim() : err.message;
    throw Object.assign(docketError(CODES.GIT, `git ${args[0]} failed: ${stderr}`), {
      status: err.status,
    });
  }
}

/** Like git(), but returns null instead of throwing (for optional config and probes). */
export function tryGit(cwd, args) {
  try {
    return git(cwd, args).trim();
  } catch {
    return null;
  }
}

/**
 * Resolve the checkout containing `start`.
 * Returns absolute, forward-slash paths: root (worktree top level), gitDir, commonDir, itemsDir,
 * docketDir (`.docket/`, per worktree), configPath (`docket.json`).
 */
export function resolveRepo(start = ".") {
  const cwd = path.resolve(start);
  let out;
  try {
    out = git(cwd, [
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      "--git-dir",
      "--git-common-dir",
    ]);
  } catch (err) {
    throw Object.assign(docketError(CODES.NOT_A_REPO, `not inside a git worktree: ${cwd}`), {
      cause: err,
    });
  }
  const [root, gitDir, commonDir] = out.trim().split(/\r?\n/).map(toSlash);
  return contextFor(root, commonDir, gitDir);
}

/**
 * The checkout context core operations take, from facts the caller already holds: root and commonDir
 * (absolute, forward-slash) and gitDir when known. No filesystem or Git access: the caller has already
 * verified the checkout (contextAtRoot and the registered-checkout openers do).
 */
export function contextFor(root, commonDir, gitDir) {
  return {
    root,
    ...(gitDir === undefined ? {} : { gitDir }),
    commonDir,
    itemsDir: `${root}/${ITEMS_DIR}`,
    docketDir: `${root}/.docket`,
    configPath: `${root}/docket.json`,
  };
}

/**
 * The context of the checkout whose root is exactly `root`, with canonical paths. Never discovers an
 * ancestor: a subdirectory of a checkout (or a plain folder inside one) is refused, as is a path that
 * is not in a Git worktree. Throws DOCKET_NOT_A_REPO (details: {root, actual?}).
 */
export function contextAtRoot(root) {
  let real;
  try {
    real = canonicalPath(root);
  } catch {
    throw docketError(CODES.NOT_A_REPO, `no such directory: ${root}`, { root: String(root) });
  }
  const found = resolveRepo(real);
  const top = canonicalPath(found.root);
  if (!sameKey(top, real)) {
    throw docketError(CODES.NOT_A_REPO, `${real} is not a checkout root (root is ${top})`, {
      root: real,
      actual: top,
    });
  }
  return contextFor(top, canonicalPath(found.commonDir), canonicalPath(found.gitDir));
}

/** Current branch name, or null when detached. */
export function currentBranch(root) {
  return tryGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
}
