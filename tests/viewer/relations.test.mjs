import assert from "node:assert/strict";
import { test } from "node:test";
import { itemText } from "../helpers/repository.mjs";
import { appData, docketRepo, register, viewer } from "../helpers/viewer.mjs";

const hex = (n) => `dk-${n.toString(16).padStart(8, "0")}`;
const F = hex(1);
const B1 = hex(2);
const B2 = hex(3);
const C = hex(4);
const P = hex(5);
const K = hex(6);
const X = hex(7);
const item = (id, fields = {}, title = `Item ${id}`) =>
  itemText({ id, rank: "n", ...fields }, { title });

async function start(t, items, write = () => {}) {
  const data = appData();
  const r = docketRepo(items);
  write(r);
  r.commit("more");
  const reg = register(data.registryFile, r.root, { alias: "alpha" });
  const v = await viewer(data.registryFile);
  t.after(async () => {
    await v.close();
    r.cleanup();
    data.cleanup();
  });
  const base = `/api/repos/${reg.repo.id}/checkouts/${reg.checkout.id}/items`;
  const rel = async (id) => ({
    detail: (await v.get(`${base}/${id}`)).json,
    relations: await v.get(`${base}/${id}/relations`),
  });
  return { v, rel, base };
}

test("fixedBy: bugs fixing a feature", async (t) => {
  const { rel } = await start(t, {
    [F]: item(F, { type: "feature" }),
    [B1]: item(B1, { type: "bug", fixes: [F] }),
    [B2]: item(B2, { type: "bug", fixes: [F] }),
  });
  const { relations } = await rel(F);
  assert.equal(relations.status, 200);
  assert.equal(relations.json.id, F);
  assert.equal(relations.json.type, "feature");
  assert.deepEqual(relations.json.reverse.fixedBy.sort(), [B1, B2]);
  for (const b of [B1, B2]) {
    assert.equal(relations.json.related[b].state, "ok");
    assert.equal(relations.json.related[b].type, "bug");
  }
  const { relations: fwd } = await rel(B1);
  assert.deepEqual(fwd.json.forward.fixes, [F]);
  assert.equal(fwd.json.related[F].state, "ok");
  assert.equal(fwd.json.related[F].title, `Item ${F}`);
});

test("parent and children in both directions", async (t) => {
  const { rel } = await start(t, { [P]: item(P), [C]: item(C, { parent: P }) });
  const child = (await rel(C)).relations.json;
  assert.equal(child.forward.parent, P);
  assert.equal(child.related[P].state, "ok");
  const parent = (await rel(P)).relations.json;
  assert.equal(parent.forward.parent, "");
  assert.deepEqual(parent.reverse.children, [C]);
  assert.equal(parent.related[C].state, "ok");
});

test("blocked_by and blocks in both directions", async (t) => {
  const { rel } = await start(t, { [K]: item(K), [X]: item(X, { blocked_by: [K] }) });
  const blocked = (await rel(X)).relations.json;
  assert.deepEqual(blocked.forward.blocked_by, [K]);
  const blocker = (await rel(K)).relations.json;
  assert.deepEqual(blocker.reverse.blocks, [X]);
  assert.equal(blocker.related[X].state, "ok");
});

test("relates is symmetric and reverse-stored holders carry revisions", async (t) => {
  const { rel } = await start(t, { [F]: item(F), [C]: item(C, { relates: [F] }) });
  const f = await rel(F);
  const c = await rel(C);
  assert.deepEqual(f.relations.json.forward.relates, []);
  assert.deepEqual(f.relations.json.reverse.relates, [C]);
  assert.deepEqual(f.relations.json.reverseStored, [C]);
  assert.equal(f.relations.json.related[C].state, "ok");
  assert.equal(f.relations.json.revisions[F], f.detail.revision);
  assert.equal(f.relations.json.revisions[C], c.detail.revision);
  assert.equal(f.relations.json.revision, f.detail.revision);
  assert.deepEqual(c.relations.json.forward.relates, [F]);
  assert.deepEqual(c.relations.json.reverseStored, []);
});

test("missing and malformed targets have explicit states", async (t) => {
  const { rel } = await start(
    t,
    { [F]: item(F, { fixes: ["dk-0000dead"], relates: ["dk-0000bad1"] }) },
    (r) => r.write("dk-0000bad1", "not an item\n"),
  );
  const { relations } = await rel(F);
  assert.equal(relations.status, 200);
  assert.deepEqual(relations.json.related["dk-0000dead"], { state: "missing" });
  assert.equal(relations.json.related["dk-0000bad1"].state, "malformed");
});

test("relations of an unknown or malformed id are 404 / 400", async (t) => {
  const { v, base } = await start(t, { [F]: item(F) });
  assert.equal((await v.get(`${base}/dk-0000dead/relations`)).status, 404);
  assert.equal((await v.get(`${base}/dk-xyz/relations`)).status, 400);
});
