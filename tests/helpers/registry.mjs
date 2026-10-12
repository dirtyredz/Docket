// Registry and checkout test support: disposable application-data roots (never the owner's registry),
// registrable fixture repos, linked worktrees, registration, and directory links.
import fs from "node:fs";
import path from "node:path";
import { inspectCheckout } from "../../src/repository/registered-checkout.mjs";
import { registerCheckout } from "../../src/state/registry/registration.mjs";
import { updateRegistry } from "../../src/state/registry/store.mjs";
import { git, makeRepo, tempDir } from "./repository.mjs";

/** A temp DOCKET_HOME. Returns {home, registryFile, env, cleanup}. */
export function appData() {
  const { dir, cleanup } = tempDir("docket app data ");
  return {
    home: dir,
    registryFile: path.join(dir, "registry.json"),
    env: { DOCKET_HOME: dir },
    cleanup,
  };
}

/** makeRepo plus a committed docket.json, so it can be opened and registered. */
export function docketRepo(items = {}, options) {
  const r = makeRepo(items, options);
  fs.writeFileSync(path.join(r.root, "docket.json"), '{\n  "version": 1\n}\n');
  r.commit("init");
  return r;
}

/** Add a linked worktree of `r` at `<r.dir>/<name>` on a new branch. Returns its path. */
export function addWorktree(r, name = "wt", branch = name) {
  const wt = path.join(r.dir, name);
  git(r.root, "worktree", "add", "-q", "-b", branch, wt);
  return wt;
}

/** Register checkout `p` in `registryFile` (options as registerCheckout). Returns {repo, checkout}. */
export function register(registryFile, p, options) {
  const info = inspectCheckout(p);
  return updateRegistry(registryFile, (reg) => ({ value: registerCheckout(reg, info, options) }))
    .value;
}

/** Create a directory link (a junction on Windows); false when the platform refuses (no privilege). */
export function linkDir(target, p) {
  try {
    fs.symlinkSync(target, p, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch (err) {
    if (err.code === "EPERM" || err.code === "EACCES") return false;
    throw err;
  }
}

/** Create a file symlink; false when the platform refuses (Windows without the privilege). */
export function linkFile(target, p) {
  try {
    fs.symlinkSync(target, p, "file");
    return true;
  } catch (err) {
    if (err.code === "EPERM" || err.code === "EACCES") return false;
    throw err;
  }
}
