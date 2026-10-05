// Viewer editing: scalar saves and relation edits over HTTP, checked against the files on disk and
// against the CLI as the reference implementation.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { git, itemText, readItem, runCli } from "../helpers/repository.mjs";
import { addWorktree, appData, docketRepo, register, viewer } from "../helpers/viewer.mjs";

const hex = (n) => `dk-${n.toString(16).padStart(8, "0")}`;
const A = hex(1);
const B = hex(2);
const C = hex(3);
const F = hex(4);
const BODY = "First paragraph.\n\n## Heading\n\n- one\n- two\n\n```js\nconst x = 1;\n```\n";
const item = (id, fields = {}, opts = {}) =>
  itemText({ id, rank: "n", ...fields }, { title: `Item ${id}`, body: BODY, ...opts });

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Everything after the H1 line. */
const afterTitle = (text) =>
  text
    .slice(text.indexOf("\n# ") + 1)
    .split("\n")
    .slice(1)
    .join("\n");

/** Disposable app data, one registered repo with `items`, and a running server. */
async function start(t, items, { alias = "alpha" } = {}) {
  const data = appData();
  const r = docketRepo(items);
  const reg = register(data.registryFile, r.root, { alias });
  const v = await viewer(data.registryFile);
  t.after(async () => {
    await v.close();
    r.cleanup();
    data.cleanup();
  });
  const base = `/api/repos/${reg.repo.id}/checkouts/${reg.checkout.id}/items`;
  const revision = async (id) => (await v.get(`${base}/${id}`)).json.revision;
  const relations = async (id) => (await v.get(`${base}/${id}/relations`)).json;
  return { v, r, reg, base, revision, relations };
}

test("scalar save changes the file, keeps the body bytes, and bumps since", async (t) => {
  const { v, r, base, revision } = await start(t, { [A]: item(A) });
  const before = readItem(r.root, A);
  const res = await v.post(`${base}/${A}`, {
    expected: await revision(A),
    title: "Renamed",
    status: "wip",
    priority: "P0",
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.id, A);
  assert.equal(res.json.noop, false);
  assert.ok(res.json.revision);
  assert.deepEqual(res.json.warnings, []);
  const after = readItem(r.root, A);
  assert.notEqual(after, before);
  assert.match(after, /^# Renamed$/m);
  assert.match(after, /^status: wip$/m);
  assert.match(after, /^priority: P0$/m);
  assert.match(after, new RegExp(`^since: ${today()}$`, "m"));
  assert.equal(afterTitle(after), afterTitle(before));
  const detail = (await v.get(`${base}/${A}`)).json;
  assert.equal(detail.revision, res.json.revision);
  assert.equal(detail.title, "Renamed");
});

test("a priority-only save leaves since alone", async (t) => {
  const { v, r, base, revision } = await start(t, { [A]: item(A) });
  const res = await v.post(`${base}/${A}`, { expected: await revision(A), priority: "P1" });
  assert.equal(res.status, 200, res.text);
  const after = readItem(r.root, A);
  assert.match(after, /^priority: P1$/m);
  assert.match(after, /^since: 2026-01-01$/m);
});

test("viewer save is byte-identical to the CLI on an identical repo", async (t) => {
  const { v, r, base, revision } = await start(t, { [A]: item(A) });
  const twin = docketRepo({ [A]: item(A) });
  t.after(() => twin.cleanup());
  const cli = runCli(["set", A, "--status", "wip", "--repo", twin.root]);
  assert.equal(cli.status, 0, cli.stderr);
  const res = await v.post(`${base}/${A}`, { expected: await revision(A), status: "wip" });
  assert.equal(res.status, 200, res.text);
  assert.equal(readItem(r.root, A), readItem(twin.root, A));
});

test("stale revision is a 409 and writes nothing; the fresh one saves", async (t) => {
  const { v, r, base, revision } = await start(t, { [A]: item(A) });
  const old = await revision(A);
  const cli = runCli(["set", A, "--status", "wip", "--repo", r.root]);
  assert.equal(cli.status, 0, cli.stderr);
  const onDisk = readItem(r.root, A);
  const stale = await v.post(`${base}/${A}`, { expected: old, priority: "P0" });
  assert.equal(stale.status, 409, stale.text);
  assert.equal(stale.json.error.details.id, A);
  assert.equal(stale.json.error.details.expected, old);
  assert.ok(stale.json.error.details.actual);
  assert.notEqual(stale.json.error.details.actual, old);
  assert.equal(readItem(r.root, A), onDisk);
  const fresh = await v.post(`${base}/${A}`, {
    expected: stale.json.error.details.actual,
    priority: "P0",
  });
  assert.equal(fresh.status, 200, fresh.text);
  assert.match(readItem(r.root, A), /^priority: P0$/m);
});

test("a no-op save asserts the revision: stale is 409, current is 200 noop", async (t) => {
  const { v, r, base, revision } = await start(t, { [A]: item(A) });
  const old = await revision(A);
  const cli = runCli(["set", A, "--priority", "P1", "--repo", r.root]);
  assert.equal(cli.status, 0, cli.stderr);
  const onDisk = readItem(r.root, A);
  const stale = await v.post(`${base}/${A}`, { expected: old, status: "todo" });
  assert.equal(stale.status, 409, stale.text);
  const current = await v.post(`${base}/${A}`, { expected: await revision(A), status: "todo" });
  assert.equal(current.status, 200, current.text);
  assert.equal(current.json.noop, true);
  assert.equal(readItem(r.root, A), onDisk);
});

test("field allowlist and validation rejections are 400 and write nothing", async (t) => {
  const { v, r, base, revision } = await start(t, { [A]: item(A) });
  const onDisk = readItem(r.root, A);
  const expected = await revision(A);
  const bad = [
    ["no expected", { status: "wip" }],
    ["body", { expected, body: "x" }],
    ["type", { expected, type: "bug" }],
    ["rank", { expected, rank: "a" }],
    ["area", { expected, area: "x" }],
    ["id", { expected, id: hex(9) }],
    ["created", { expected, created: "2020-01-01" }],
    ["unknown alongside valid", { expected, status: "wip", body: "x" }],
    ["bad status", { expected, status: "nope" }],
    ["bad priority", { expected, priority: "P9" }],
    ["non-string title", { expected, title: 5 }],
    ["empty change set", { expected }],
  ];
  for (const [name, body] of bad) {
    const res = await v.post(`${base}/${A}`, body);
    assert.equal(res.status, 400, `${name}: ${res.text}`);
    assert.ok(res.json.error.code, name);
    assert.equal(readItem(r.root, A), onDisk, name);
  }
  assert.equal((await v.post(`${base}/dk-xyz`, { expected, status: "wip" })).status, 400);
  assert.equal((await v.post(`${base}/dk-0000dead`, { expected, status: "wip" })).status, 404);
});

test("completing an item releases its claim", async (t) => {
  const { v, r, base, revision } = await start(t, { [A]: item(A) });
  const claim = runCli(["claim", A, "--repo", r.root]);
  assert.equal(claim.status, 0, claim.stderr);
  assert.ok((await v.get(`${base}/${A}`)).json.claim);
  const res = await v.post(`${base}/${A}`, { expected: await revision(A), status: "done" });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.completed, true);
  assert.equal(res.json.claimReleased, true);
  assert.deepEqual(res.json.warnings, []);
  assert.equal((await v.get(`${base}/${A}`)).json.claim, null);
  assert.match(readItem(r.root, A), /^status: done$/m);
});

// A claim-cleanup failure is a successful save with a warning (core/items/complete.mjs). Forcing it
// from outside needs the claims store to throw while the item write succeeds, which cannot be set up
// without editing src or mocking the injected store; the unit-level behaviour belongs to core tests.

test("saves hit exactly the selected checkout, main or linked worktree", async (t) => {
  const data = appData();
  const main = docketRepo({ [A]: item(A) });
  const wt = addWorktree(main, "wt");
  const mainReg = register(data.registryFile, main.root, { alias: "alpha" });
  const wtReg = register(data.registryFile, wt, { alias: "alpha" });
  const v = await viewer(data.registryFile);
  t.after(async () => {
    await v.close();
    main.cleanup();
    data.cleanup();
  });
  assert.equal(mainReg.repo.id, wtReg.repo.id);
  assert.notEqual(mainReg.checkout.id, wtReg.checkout.id);
  const baseOf = (reg) => `/api/repos/${reg.repo.id}/checkouts/${reg.checkout.id}/items`;
  const mainFile = () => fs.readFileSync(path.join(main.root, "docs", "items", `${A}.md`), "utf8");
  const wtFile = () => fs.readFileSync(path.join(wt, "docs", "items", `${A}.md`), "utf8");
  const original = mainFile();
  assert.equal(wtFile(), original);

  const rev = (await v.get(`${baseOf(wtReg)}/${A}`)).json.revision;
  const r1 = await v.post(`${baseOf(wtReg)}/${A}`, { expected: rev, title: "In worktree" });
  assert.equal(r1.status, 200, r1.text);
  assert.match(wtFile(), /^# In worktree$/m);
  assert.equal(mainFile(), original);

  const mainRev = (await v.get(`${baseOf(mainReg)}/${A}`)).json.revision;
  const wtAfter = wtFile();
  const r2 = await v.post(`${baseOf(mainReg)}/${A}`, { expected: mainRev, priority: "P0" });
  assert.equal(r2.status, 200, r2.text);
  assert.match(mainFile(), /^priority: P0$/m);
  assert.equal(wtFile(), wtAfter);
  assert.equal(git(main.root, "status", "--porcelain").includes("docs/items"), true);
});

test("relations: fixes add and remove between a bug and a feature", async (t) => {
  const { v, r, base, relations } = await start(t, {
    [B]: item(B, { type: "bug" }),
    [F]: item(F, { type: "feature" }),
  });
  const rel = `${base}/${B}/relations`;
  const add = await v.post(rel, {
    action: "add",
    key: "fixes",
    target: F,
    expected: (await relations(B)).revisions,
  });
  assert.equal(add.status, 200, add.text);
  assert.deepEqual(add.json.changes, [{ op: "add", key: "fixes", target: F }]);
  assert.deepEqual(add.json.relations.forward.fixes, [F]);
  assert.match(readItem(r.root, B), /^fixes: \[dk-00000004\]$/m);
  assert.deepEqual((await relations(F)).reverse.fixedBy, [B]);

  const remove = await v.post(rel, {
    action: "remove",
    key: "fixes",
    target: F,
    expected: (await relations(B)).revisions,
  });
  assert.equal(remove.status, 200, remove.text);
  assert.match(readItem(r.root, B), /^fixes: \[\]$/m);
  assert.deepEqual(remove.json.relations.forward.fixes, []);
});

test("relations: parent set, remove, and cycle rejection", async (t) => {
  const { v, r, base, relations } = await start(t, { [A]: item(A), [B]: item(B) });
  const post = async (id, action, target) =>
    v.post(`${base}/${id}/relations`, {
      action,
      key: "parent",
      target,
      expected: (await relations(id)).revisions,
    });
  const set = await post(B, "add", A);
  assert.equal(set.status, 200, set.text);
  assert.match(readItem(r.root, B), /^parent: dk-00000001$/m);
  assert.deepEqual((await relations(A)).reverse.children, [B]);

  const onDisk = [readItem(r.root, A), readItem(r.root, B)];
  const cycle = await post(A, "add", B);
  assert.equal(cycle.status, 422, cycle.text);
  assert.equal(cycle.json.error.code, "DOCKET_INVALID");
  assert.deepEqual([readItem(r.root, A), readItem(r.root, B)], onDisk);

  const clear = await post(B, "remove", A);
  assert.equal(clear.status, 200, clear.text);
  assert.match(readItem(r.root, B), /^parent:$/m);
});

test("relations: blocked_by and relates add/remove", async (t) => {
  const { v, r, base, relations } = await start(t, { [A]: item(A), [B]: item(B) });
  const edit = async (id, action, key, target) =>
    v.post(`${base}/${id}/relations`, {
      action,
      key,
      target,
      expected: (await relations(id)).revisions,
    });
  const block = await edit(A, "add", "blocked_by", B);
  assert.equal(block.status, 200, block.text);
  assert.match(readItem(r.root, A), /^blocked_by: \[dk-00000002\]$/m);
  assert.deepEqual((await relations(B)).reverse.blocks, [A]);
  const unblock = await edit(A, "remove", "blocked_by", B);
  assert.equal(unblock.status, 200, unblock.text);
  assert.match(readItem(r.root, A), /^blocked_by: \[\]$/m);

  const relate = await edit(A, "add", "relates", B);
  assert.equal(relate.status, 200, relate.text);
  assert.match(readItem(r.root, A), /^relates: \[dk-00000002\]$/m);
  assert.deepEqual((await relations(B)).reverse.relates, [A]);
  // Adding the mirrored edge is a no-op: relates is stored once.
  const mirror = await edit(B, "add", "relates", A);
  assert.equal(mirror.status, 200, mirror.text);
  assert.deepEqual(mirror.json.changes, []);
  assert.match(readItem(r.root, B), /^relates: \[\]$/m);
});

test("relations: removing a reverse-stored relates edits the holder", async (t) => {
  const { v, r, base, relations } = await start(t, {
    [F]: item(F),
    [C]: item(C, { relates: [F] }),
  });
  const url = `${base}/${F}/relations`;
  const body = (expected) => ({ action: "remove", key: "relates", target: C, expected });
  const fBefore = readItem(r.root, F);
  const cBefore = readItem(r.root, C);

  const { revisions } = await relations(F);
  assert.ok(revisions[C]);

  const missingHolder = await v.post(url, body({ [F]: revisions[F] }));
  assert.equal(missingHolder.status, 400, missingHolder.text);
  assert.equal(missingHolder.json.error.code, "DOCKET_USAGE");
  assert.equal(readItem(r.root, F), fBefore);
  assert.equal(readItem(r.root, C), cBefore);

  const cli = runCli(["set", C, "--priority", "P1", "--repo", r.root]);
  assert.equal(cli.status, 0, cli.stderr);
  const cChanged = readItem(r.root, C);
  const stale = await v.post(url, body(revisions));
  assert.equal(stale.status, 409, stale.text);
  assert.equal(readItem(r.root, F), fBefore);
  assert.equal(readItem(r.root, C), cChanged);

  const ok = await v.post(url, body((await relations(F)).revisions));
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.json.changes, [{ op: "remove", key: "relates", target: C, storedOn: C }]);
  assert.match(readItem(r.root, C), /^relates: \[\]$/m);
  assert.equal(readItem(r.root, F), fBefore);
});

test("relations: stale, missing own revision and unknown fields are refused", async (t) => {
  const { v, r, base, relations } = await start(t, { [A]: item(A), [B]: item(B) });
  const url = `${base}/${A}/relations`;
  const { revisions } = await relations(A);
  const onDisk = readItem(r.root, A);
  const edit = { action: "add", key: "relates", target: B };

  const stale = await v.post(url, { ...edit, expected: { [A]: "0".repeat(revisions[A].length) } });
  assert.equal(stale.status, 409, stale.text);
  assert.equal((await v.post(url, { ...edit, expected: {} })).status, 400);
  assert.equal((await v.post(url, { ...edit, expected: { [B]: revisions[A] } })).status, 400);
  const extra = await v.post(url, { ...edit, expected: revisions, rank: "a" });
  assert.equal(extra.status, 400, extra.text);
  assert.equal(readItem(r.root, A), onDisk);
});

test("mutations require the viewer token and a same-origin request", async (t) => {
  const { v, r, base, revision, relations } = await start(t, { [A]: item(A), [B]: item(B) });
  const onDisk = [readItem(r.root, A), readItem(r.root, B)];
  const save = { expected: await revision(A), status: "wip" };
  const link = {
    action: "add",
    key: "relates",
    target: B,
    expected: (await relations(A)).revisions,
  };
  const routes = [
    [`${base}/${A}`, save],
    [`${base}/${A}/relations`, link],
  ];
  for (const [url, body] of routes) {
    assert.equal((await v.post(url, body, { token: null })).status, 403, `${url} token`);
    assert.equal((await v.post(url, body, { origin: null })).status, 403, `${url} origin`);
  }
  assert.deepEqual([readItem(r.root, A), readItem(r.root, B)], onDisk);
});
