import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { makeRepo, runCli, git, itemText, readItem } from "../../helpers/repository.mjs";
import { resolveRepo } from "../../../src/repository/context.mjs";
import { claimsPath, readClaims, releaseItem } from "../../../src/state/claims/store.mjs";

function setup(t) {
  const repo = makeRepo();
  t.after(repo.cleanup);
  repo.commit();
  const cli = (...args) => {
    const r = runCli([...args, "--repo", repo.root, "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return r.json.data;
  };
  const add = (status = "wip") =>
    cli("add", "--type", "task", "--priority", "P2", "--title", "Work", "--status", status).id;
  return { ...repo, cli, add, ctx: resolveRepo(repo.root) };
}

test("add, set and claim record WIP bindings without changing the item keys", (t) => {
  const { cli, add, ctx, root } = setup(t);
  const a = add();
  const b = add("todo");
  cli("set", b, "--status", "wip");
  const c = add("todo");
  cli("claim", c);
  for (const id of [a, b, c]) {
    const [row] = cli("activity", "--id", id).items;
    assert.equal(row.branch, "main");
    assert.equal(row.worktree, ctx.root);
    assert.equal(cli("show", id).status, "wip");
    assert.equal(readItem(root, id).split("---")[1].trim().split("\n").length, 12);
  }
});

test("bindings survive explicit claim release and expiry cleanup", (t) => {
  const { cli, add, ctx } = setup(t);
  const id = add("todo");
  cli("claim", id);
  cli("release", id);
  assert.equal(cli("activity").items[0].branch, "main");
  cli("claim", id);
  assert.deepEqual(readClaims(ctx.commonDir, { exists: () => false }).expired, [id]);
  const file = claimsPath(ctx.commonDir);
  const raw = JSON.parse(fs.readFileSync(file));
  raw.claims[id].worktree = path.join(ctx.root, "gone");
  fs.writeFileSync(file, JSON.stringify(raw));
  releaseItem(ctx.commonDir, id, { worktree: ctx.root });
  assert.equal(cli("activity").items[0].branch, "main");
});

test("activity is read-only, filters repeated IDs and reports unrecorded, detached and missing refs", (t) => {
  const { cli, add, root, ctx, write } = setup(t);
  const known = add();
  write("dk-00000001", itemText({ status: "wip" }));
  const before = fs.readFileSync(claimsPath(ctx.commonDir));
  const rows = cli("activity", "--id", known, "--id", "dk-00000001").items;
  assert.equal(rows.length, 2);
  const unknown = rows.find((r) => r.id === "dk-00000001");
  assert.equal(unknown.unknownReason, "unrecorded");
  assert.equal(unknown.quietDays, null);
  assert.deepEqual(fs.readFileSync(claimsPath(ctx.commonDir)), before);
  git(root, "checkout", "--detach", "-q");
  const detached = add();
  assert.equal(cli("activity", "--id", detached).items[0].unknownReason, "detached");
  git(root, "branch", "-D", "main");
  const missing = cli("activity", "--id", known).items[0];
  assert.equal(missing.unknownReason, "missing-ref");
  assert.equal(missing.lastCommitAt, null);
  assert.equal(missing.quietDays, null);
});

test("worktree release resets matching WIP once and leaves closed and reassigned items alone", (t) => {
  const { cli, add, ctx, root } = setup(t);
  const active = add();
  const done = add();
  const dropped = add();
  const other = add();
  cli("set", done, "--status", "done");
  cli("set", dropped, "--status", "dropped");
  const raw = JSON.parse(fs.readFileSync(claimsPath(ctx.commonDir)));
  raw.work[other].worktree = `${ctx.root}/other`;
  fs.writeFileSync(claimsPath(ctx.commonDir), JSON.stringify(raw));
  const untouched = [done, dropped, other].map((id) => readItem(root, id));
  assert.equal(cli("worktree", "release", "--path", `${root}/unrelated`).count, 0);
  assert.equal(cli("worktree", "release", "--path", `${root}/.`).count, 1);
  const shown = cli("show", active);
  assert.equal(shown.status, "todo");
  assert.equal(shown.notes.length, 1);
  assert.match(shown.notes[0].text, /work stopped/);
  const once = readItem(root, active);
  assert.equal(cli("worktree", "release", "--path", root).count, 0);
  assert.equal(readItem(root, active), once);
  assert.deepEqual(
    [done, dropped, other].map((id) => readItem(root, id)),
    untouched,
  );
});

test("batch WIP binds, same-status set does not reassign, and removed worktrees release", (t) => {
  const { cli, root, ctx, dir, commit } = setup(t);
  const batch = runCli(["add", "--batch", "-", "--json", "--repo", root], {
    input: JSON.stringify([{ type: "task", priority: "P2", title: "Batch", status: "wip" }]),
  });
  assert.equal(batch.status, 0, batch.stdout + batch.stderr);
  const id = batch.json.data.items[0].id;
  assert.equal(cli("activity", "--id", id).items[0].worktree, ctx.root);
  commit();
  const linked = path.join(dir, "linked");
  git(root, "worktree", "add", "-q", "-b", "feature", linked);
  const claimed = runCli(["claim", id, "--repo", linked, "--json"]);
  assert.equal(claimed.status, 0, claimed.stdout + claimed.stderr);
  cli("set", id, "--status", "wip");
  assert.equal(cli("activity", "--id", id).items[0].branch, "feature");
  assert.equal(cli("worktree", "release", "--path", root).count, 0);
  git(root, "worktree", "remove", "--force", linked);
  assert.equal(cli("worktree", "release", "--path", linked).count, 1);
  assert.equal(cli("worktree", "release", "--path", linked).count, 0);
});
