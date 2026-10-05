// Worktree and common-dir discovery. Everything that asks "which checkout is this?" goes through here.
import { execFileSync } from "node:child_process";
import path from "node:path";

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
    throw Object.assign(new Error(`git ${args[0]} failed: ${stderr}`), {
      code: "DOCKET_GIT",
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

const toSlash = (p) => p.split(path.sep).join("/");

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
    throw Object.assign(new Error(`not inside a git worktree: ${cwd}`), {
      code: "DOCKET_NOT_A_REPO",
      cause: err,
    });
  }
  const [root, gitDir, commonDir] = out.trim().split(/\r?\n/).map(toSlash);
  return {
    root,
    gitDir,
    commonDir,
    itemsDir: `${root}/docs/items`,
    docketDir: `${root}/.docket`,
    configPath: `${root}/docket.json`,
  };
}

/** Current branch name, or null when detached. */
export function currentBranch(root) {
  return tryGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
}
