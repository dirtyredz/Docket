import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { itemText, runCli } from "../../helpers/repository.mjs";
import { addWorktree, appData, docketRepo, register, viewer } from "../../helpers/viewer.mjs";

const ID = "dk-00000001";

async function start(t) {
  const data = appData();
  const r = docketRepo({ [ID]: itemText({ id: ID }) });
  const wt = addWorktree(r, "wt", "feature-x");
  const reg = register(data.registryFile, r.root, { alias: "alpha" });
  const v = await viewer(data.registryFile);
  t.after(async () => {
    await v.close();
    r.cleanup();
    data.cleanup();
  });
  return { v, data, r, wt, reg };
}

const norm = (p) => p.replaceAll("\\", "/").toLowerCase();
const hints = async (v, reg) => (await v.get(`/api/repos/${reg.repo.id}/worktrees`)).json;
const find = (h, p) => h.worktrees.find((w) => norm(w.path) === norm(p));

test("lists main and linked worktrees; an unregistered one has no checkout id", async (t) => {
  const { v, r, wt, reg } = await start(t);
  const h = await hints(v, reg);
  assert.equal(h.repo.id, reg.repo.id);
  assert.equal(h.advisory, true);
  assert.equal(h.worktrees.length, 2);
  const main = find(h, r.root);
  const linked = find(h, wt);
  assert.equal(main.main, true);
  assert.equal(main.branch, "main");
  assert.equal(main.checkoutId, reg.checkout.id);
  assert.equal(main.preferred, true);
  assert.equal(linked.main, false);
  assert.equal(linked.branch, "feature-x");
  assert.equal(linked.detached, false);
  assert.equal(linked.exists, true);
  assert.equal(linked.checkoutId, null);
  assert.equal(linked.preferred, false);
});

test("registering the worktree sets its checkout id", async (t) => {
  const { v, data, wt, reg } = await start(t);
  const second = register(data.registryFile, wt, { alias: "alpha" });
  assert.equal(second.repo.id, reg.repo.id);
  const h = await hints(v, reg);
  assert.equal(find(h, wt).checkoutId, second.checkout.id);
});

test("a claim made in the worktree shows under that worktree only", async (t) => {
  const { v, r, wt, reg } = await start(t);
  const c = runCli(["claim", ID, "--repo", wt]);
  assert.equal(c.status, 0, c.stderr);
  const h = await hints(v, reg);
  const claims = find(h, wt).claims;
  assert.equal(claims.length, 1);
  assert.equal(claims[0].id, ID);
  assert.equal(norm(claims[0].worktree), norm(wt));
  assert.ok(claims[0].at);
  assert.deepEqual(find(h, r.root).claims, []);
});

test("observedAt is an ISO timestamp and hints never touch the registry", async (t) => {
  const { v, data, reg } = await start(t);
  const before = fs.readFileSync(data.registryFile);
  const h = await hints(v, reg);
  assert.equal(new Date(h.observedAt).toISOString(), h.observedAt);
  await hints(v, reg);
  assert.ok(before.equals(fs.readFileSync(data.registryFile)));
});

test("unknown repo is 404, malformed repo id is 400", async (t) => {
  const { v } = await start(t);
  assert.equal((await v.get("/api/repos/r-00000000/worktrees")).status, 404);
  assert.equal((await v.get("/api/repos/nope/worktrees")).status, 400);
});
