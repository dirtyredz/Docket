import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { makeRepo } from "../../helpers/repository.mjs";
import { branchActivity } from "../../../src/repository/work-activity.mjs";

test("activity follows branch-tip committer time, floors days and clamps future commits", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  const commit = (date) =>
    execFileSync("git", ["commit", "--allow-empty", "-m", "work"], {
      cwd: repo.root,
      env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: date },
      stdio: "pipe",
    });
  const now = new Date("2026-11-20T12:00:00Z");
  commit("2026-11-10T13:00:00Z");
  const first = branchActivity(repo.root, "main", now);
  assert.equal(first.quietDays, 9);
  assert.equal(first.lastCommitAt, "2026-11-10T13:00:00.000Z");
  commit("2026-11-19T13:00:00Z");
  assert.equal(branchActivity(repo.root, "main", now).quietDays, 0);
  commit("2026-11-21T13:00:00Z");
  assert.equal(branchActivity(repo.root, "main", now).quietDays, 0);
});
