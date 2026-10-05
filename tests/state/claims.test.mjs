import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { claimItem, claimsPath, readClaims, releaseItem } from "../../src/state/claims/store.mjs";
import { resolveRepo } from "../../src/repository/context.mjs";
import { ROOT, git, itemText, makeRepo, runCli, tempDir } from "../helpers/repository.mjs";

function setup(t) {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const commonDir = path.join(dir, "common");
  const a = path.join(dir, "wt-a");
  const b = path.join(dir, "wt-b");
  for (const d of [commonDir, a, b]) fs.mkdirSync(d);
  return { dir, commonDir, a, b };
}

const slash = (p) => p.split(path.sep).join("/");

test("claim records the holder and readClaims lists it", (t) => {
  const { commonDir, a } = setup(t);
  const { claim, previous } = claimItem(commonDir, "dk-1", {
    worktree: a,
    branch: "x",
    agent: "me",
  });
  assert.equal(previous, null);
  assert.equal(claim.worktree, slash(a));
  assert.equal(claim.branch, "x");
  assert.equal(claim.agent, "me");
  const { claims, expired } = readClaims(commonDir);
  assert.deepEqual(claims["dk-1"], claim);
  assert.deepEqual(expired, []);
});

test("re-claiming from the same worktree refreshes `at`", (t) => {
  const { commonDir, a } = setup(t);
  claimItem(commonDir, "dk-1", { worktree: a, now: new Date("2026-01-01T00:00:00Z") });
  const { claim, previous } = claimItem(commonDir, "dk-1", {
    worktree: a,
    now: new Date("2026-02-01T00:00:00Z"),
  });
  assert.equal(previous.at, "2026-01-01T00:00:00.000Z");
  assert.equal(claim.at, "2026-02-01T00:00:00.000Z");
  assert.equal(readClaims(commonDir).claims["dk-1"].at, claim.at);
});

test("a claim held by another live worktree is rejected unless takeover", (t) => {
  const { commonDir, a, b } = setup(t);
  claimItem(commonDir, "dk-1", { worktree: a });
  assert.throws(
    () => claimItem(commonDir, "dk-1", { worktree: b }),
    (err) => {
      assert.equal(err.code, "DOCKET_CLAIMED");
      assert.equal(err.details.holder.worktree, slash(a));
      return true;
    },
  );
  assert.equal(readClaims(commonDir).claims["dk-1"].worktree, slash(a));
  const { claim, previous } = claimItem(commonDir, "dk-1", { worktree: b, takeover: true });
  assert.equal(previous.worktree, slash(a));
  assert.equal(claim.worktree, slash(b));
});

test("release: owner ok, non-owner rejected unless force, unclaimed is a no-op", (t) => {
  const { commonDir, a, b } = setup(t);
  claimItem(commonDir, "dk-1", { worktree: a });
  assert.throws(() => releaseItem(commonDir, "dk-1", { worktree: b }), { code: "DOCKET_CLAIMED" });
  assert.ok(readClaims(commonDir).claims["dk-1"]);
  const forced = releaseItem(commonDir, "dk-1", { worktree: b, force: true });
  assert.equal(forced.released, true);
  assert.deepEqual(readClaims(commonDir).claims, {});

  claimItem(commonDir, "dk-2", { worktree: a });
  assert.equal(releaseItem(commonDir, "dk-2", { worktree: a }).released, true);
  assert.deepEqual(releaseItem(commonDir, "dk-2", { worktree: a }), {
    released: false,
    claim: null,
  });
});

test("a claim whose worktree vanished expires on read and is dropped on the next write", (t) => {
  const { commonDir, a, b } = setup(t);
  claimItem(commonDir, "dk-1", { worktree: a });
  claimItem(commonDir, "dk-2", { worktree: b });
  fs.rmSync(a, { recursive: true });
  const { claims, expired } = readClaims(commonDir);
  assert.deepEqual(Object.keys(claims), ["dk-2"]);
  assert.deepEqual(expired, ["dk-1"]);
  // still in the file until something writes
  assert.ok(JSON.parse(fs.readFileSync(claimsPath(commonDir), "utf8")).claims["dk-1"]);
  claimItem(commonDir, "dk-3", { worktree: b });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(claimsPath(commonDir), "utf8")).claims), [
    "dk-2",
    "dk-3",
  ]);
  // an expired claim can be taken by anyone without takeover
  const c = path.join(path.dirname(b), "wt-c");
  fs.mkdirSync(c);
  fs.rmSync(b, { recursive: true });
  claimItem(commonDir, "dk-2", { worktree: c });
});

test("a corrupt claims file is tolerated", (t) => {
  const { commonDir, a } = setup(t);
  fs.writeFileSync(claimsPath(commonDir), "{ not json");
  assert.deepEqual(readClaims(commonDir), { claims: {}, expired: [] });
  claimItem(commonDir, "dk-1", { worktree: a });
  assert.deepEqual(Object.keys(readClaims(commonDir).claims), ["dk-1"]);
  fs.writeFileSync(claimsPath(commonDir), JSON.stringify({ claims: [] }));
  assert.deepEqual(readClaims(commonDir).claims, {});
});

test("parallel processes claiming distinct ids lose no update", { timeout: 120000 }, async (t) => {
  const { commonDir, a } = setup(t);
  const storeUrl = pathToFileURL(path.join(ROOT, "src", "state", "claims", "store.mjs")).href;
  const runChild = (n) =>
    new Promise((resolve, reject) => {
      const script = `
        import { claimItem } from ${JSON.stringify(storeUrl)};
        for (let i = 0; i < 10; i++)
          claimItem(${JSON.stringify(commonDir)}, "dk-p${n}-" + i, { worktree: ${JSON.stringify(a)} });
      `;
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (status) => (status === 0 ? resolve() : reject(new Error(stderr))));
    });
  await Promise.all([0, 1, 2, 3].map(runChild));
  const { claims } = readClaims(commonDir);
  assert.equal(Object.keys(claims).length, 40);
});

function linkedPair(t, ids = ["dk-00000001"]) {
  const repo = makeRepo();
  t.after(repo.cleanup);
  for (const id of ids) repo.write(id, itemText({ id }));
  repo.commit("items");
  const wt = path.join(repo.dir, "linked wt");
  git(repo.root, "worktree", "add", "-q", "-b", "feature", wt);
  return { ...repo, wt };
}

test("linked worktrees share one commonDir", (t) => {
  const { root, wt } = linkedPair(t);
  const main = resolveRepo(root);
  const linked = resolveRepo(wt);
  assert.equal(linked.commonDir, main.commonDir);
  assert.notEqual(linked.root, main.root);
});

test("a claim made in a linked worktree is visible from main", { timeout: 120000 }, (t) => {
  const { root, wt } = linkedPair(t);
  const id = "dk-00000001";
  const c = runCli(["claim", id, "--repo", wt, "--json"]);
  assert.equal(c.status, 0, c.stderr);
  const shown = runCli(["show", id, "--json", "--repo", root]);
  assert.equal(shown.status, 0, shown.stderr);
  const claim = shown.json.data.claim;
  assert.equal(claim.worktree, resolveRepo(wt).root);
  assert.equal(claim.branch, "feature");
});

test("claiming from main then from the worktree exits 3", { timeout: 120000 }, (t) => {
  const { root, wt } = linkedPair(t);
  const id = "dk-00000001";
  assert.equal(runCli(["claim", id, "--repo", root]).status, 0);
  const second = runCli(["claim", id, "--repo", wt]);
  assert.equal(second.status, 3, second.stderr);
});

test("setting status done releases the claim", { timeout: 120000 }, (t) => {
  const { root } = linkedPair(t);
  const id = "dk-00000001";
  assert.equal(runCli(["claim", id, "--repo", root]).status, 0);
  const done = runCli(["set", id, "--status", "done", "--repo", root, "--json"]);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(done.json.data.claimReleased, true);
  assert.equal(readClaims(resolveRepo(root).commonDir).claims[id], undefined);
});
