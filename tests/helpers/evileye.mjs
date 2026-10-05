// EvilEye importer test support: a disposable git repo holding the legacy fixture backlog, committed
// with a fixed author date so first-seen dates are deterministic.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, makeRepo } from "./repository.mjs";

export const FIXTURE = path.join(ROOT, "tests", "fixtures", "evileye");
export const IMPORT_DATE_NOW = new Date(2026, 9, 4, 12, 0, 0); // 2026-10-04 local

/** Deterministic random bytes for allocation: a counter, so IDs are dk-00000001, dk-00000002, ... */
export function counterRandom(start = 1) {
  let n = start;
  return (size) => {
    const b = Buffer.alloc(size);
    b.writeUInt32BE(n++ >>> 0, 0);
    return b;
  };
}

/**
 * Fixture repo. options: {exclude (add .docket/ to .git/info/exclude, default true), date (commit
 * author date), mutate(root) (edit files before the commit)}. Returns makeRepo's handle.
 */
export function fixtureRepo({ exclude = true, date = "2026-09-25T12:00:00", mutate } = {}) {
  const r = makeRepo();
  fs.cpSync(FIXTURE, r.root, { recursive: true });
  if (mutate) mutate(r.root);
  if (exclude) fs.appendFileSync(path.join(r.root, ".git", "info", "exclude"), "\n.docket/\n");
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  execFileSync("git", ["add", "-A"], { cwd: r.root, env });
  execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: r.root, env });
  return r;
}

export const shard = (root, rel) => path.join(root, "docs", "work", "backlog", rel);
