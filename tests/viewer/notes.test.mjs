// Viewer discussion notes: add and resolve over HTTP, checked against the files on disk.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { itemText, readItem } from "../helpers/repository.mjs";
import { addWorktree, appData, docketRepo, register, viewer } from "../helpers/viewer.mjs";

const A = "dk-00000001";
const REF = "2026-10-05T14:03:00.000Z";
const noteBlock = (ref, state, text) => `\n## Notes\n\n### ${ref} · ${state} · owner\n\n${text}\n`;
const item = (id, notes = "") =>
  itemText({ id, rank: "n" }, { title: `Item ${id}`, body: `Facts.\n${notes}` });

async function start(t, items) {
  const data = appData();
  const r = docketRepo(items);
  const reg = register(data.registryFile, r.root, { alias: "alpha" });
  const v = await viewer(data.registryFile);
  t.after(async () => {
    await v.close();
    r.cleanup();
    data.cleanup();
  });
  const base = `/api/repos/${reg.repo.id}/checkouts/${reg.checkout.id}/items`;
  const detail = async () => (await v.get(`${base}/${A}`)).json;
  return { v, r, reg, base, detail };
}

test("adding a note appends an owner note, bumps revision, keeps the prefix", async (t) => {
  const { v, r, base, detail } = await start(t, { [A]: item(A) });
  const before = readItem(r.root, A);
  const d = await detail();
  assert.deepEqual(d.notes, []);
  assert.equal(d.openNoteCount, 0);
  const res = await v.post(`${base}/${A}/notes`, { expected: d.revision, text: "A question?" });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.id, A);
  assert.equal(res.json.author, "owner");
  assert.equal(res.json.state, "open");
  assert.equal(res.json.noop, false);
  assert.match(res.json.ref, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  const after = readItem(r.root, A);
  assert.ok(after.startsWith(before.replace(/\n+$/, "")));
  assert.ok(after.includes(`### ${res.json.ref} · open · owner`));
  const next = await detail();
  assert.equal(next.revision, res.json.revision);
  assert.equal(next.openNoteCount, 1);
  assert.equal(next.notes[0].text.trim(), "A question?");
  assert.equal(next.notes[0].state, "open");
  assert.equal(next.body, "Facts.\n");
});

test("note validation: 400 missing expected or extra key, 409 stale, 422 blank", async (t) => {
  const { v, r, base, detail } = await start(t, { [A]: item(A) });
  const { revision } = await detail();
  const url = `${base}/${A}/notes`;
  assert.equal((await v.post(url, { text: "x" })).status, 400);
  assert.equal((await v.post(url, { expected: revision, text: "x", author: "agent" })).status, 400);
  assert.equal((await v.post(url, { expected: revision, text: 5 })).status, 400);
  const before = readItem(r.root, A);
  assert.equal((await v.post(url, { expected: revision, text: "   \n" })).status, 422);
  assert.equal(readItem(r.root, A), before);
  const ok = await v.post(url, { expected: revision, text: "first" });
  assert.equal(ok.status, 200, ok.text);
  const written = readItem(r.root, A);
  const stale = await v.post(url, { expected: revision, text: "second" });
  assert.equal(stale.status, 409, stale.text);
  assert.equal(readItem(r.root, A), written);
});

test("resolve flips one note, is a noop when already resolved, and checks revisions", async (t) => {
  const { v, r, base, detail } = await start(t, { [A]: item(A, noteBlock(REF, "open", "Q.")) });
  const d = await detail();
  assert.equal(d.openNoteCount, 1);
  const url = `${base}/${A}/notes/${encodeURIComponent(REF)}/resolve`;
  const before = readItem(r.root, A);
  const res = await v.post(url, { expected: d.revision });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.state, "resolved");
  assert.equal(res.json.noop, false);
  assert.equal(readItem(r.root, A), before.replace(`${REF} · open`, `${REF} · resolved`));
  assert.equal((await detail()).openNoteCount, 0);

  const again = await v.post(url, { expected: res.json.revision });
  assert.equal(again.status, 200, again.text);
  assert.equal(again.json.noop, true);
  assert.equal(again.json.revision, res.json.revision);

  const stale = await v.post(url, { expected: d.revision });
  assert.equal(stale.status, 409, stale.text);

  const missing = `${base}/${A}/notes/${encodeURIComponent("2020-01-01T00:00:00.000Z")}/resolve`;
  const unknown = await v.post(missing, { expected: res.json.revision });
  assert.equal(unknown.status, 404, unknown.text);
  const extra = await v.post(url, { expected: res.json.revision, state: "open" });
  assert.equal(extra.status, 400, extra.text);
});

test("note POSTs without the CSRF token are refused", async (t) => {
  const { v, r, base, detail } = await start(t, { [A]: item(A, noteBlock(REF, "open", "Q.")) });
  const before = readItem(r.root, A);
  const { revision } = await detail();
  const add = await v.post(
    `${base}/${A}/notes`,
    { expected: revision, text: "nope" },
    { token: null },
  );
  assert.ok(add.status >= 400 && add.status < 500, add.text);
  const resolve = await v.post(
    `${base}/${A}/notes/${encodeURIComponent(REF)}/resolve`,
    { expected: revision },
    { token: null },
  );
  assert.ok(resolve.status >= 400 && resolve.status < 500, resolve.text);
  assert.equal(readItem(r.root, A), before);
});

test("a script in a note stays verbatim plain text and never reaches bodyHtml", async (t) => {
  const payload = "<script>alert(1)</script>";
  const { v, base, detail } = await start(t, { [A]: item(A, noteBlock(REF, "open", payload)) });
  const d = await detail();
  assert.ok(d.notes[0].text.includes(payload));
  assert.ok(!d.body.includes("<script"));
  assert.ok(!d.bodyHtml.includes("<script"));
  assert.ok(!d.bodyHtml.includes("alert(1)"));
  for (const key of ["bodySource", "notesSource", "notesMalformed", "openNoteCount"]) {
    assert.ok(key in d, `detail has ${key}`);
  }
  assert.equal(d.notesMalformed, false);
  const viaPost = await v.post(`${base}/${A}/notes`, { expected: d.revision, text: payload });
  assert.equal(viaPost.status, 200, viaPost.text);
  const next = await detail();
  assert.equal(next.notes.filter((n) => n.text.includes(payload)).length, 2);
  assert.ok(!next.bodyHtml.includes("<script"));
});

test("a note POST updates the board summary without a restart", async (t) => {
  const { v, base, detail } = await start(t, { [A]: item(A) });
  const board = async () => (await v.get(base)).json.items.find((i) => i.id === A);
  assert.equal((await board()).openNoteCount, 0);
  const { revision } = await detail();
  const res = await v.post(`${base}/${A}/notes`, { expected: revision, text: "Hello" });
  assert.equal(res.status, 200, res.text);
  assert.equal((await board()).openNoteCount, 1);
  const resolveUrl = `${base}/${A}/notes/${encodeURIComponent(res.json.ref)}/resolve`;
  const res2 = await v.post(resolveUrl, { expected: res.json.revision });
  assert.equal(res2.status, 200, res2.text);
  assert.equal((await board()).openNoteCount, 0);
});

test("notes hit exactly the selected checkout", async (t) => {
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
  assert.notEqual(mainReg.checkout.id, wtReg.checkout.id);
  const baseOf = (reg) => `/api/repos/${reg.repo.id}/checkouts/${reg.checkout.id}/items`;
  const file = (root) => fs.readFileSync(path.join(root, "docs", "items", `${A}.md`), "utf8");
  const original = file(main.root);
  const rev = (await v.get(`${baseOf(wtReg)}/${A}`)).json.revision;
  const res = await v.post(`${baseOf(wtReg)}/${A}/notes`, { expected: rev, text: "In worktree" });
  assert.equal(res.status, 200, res.text);
  assert.match(file(wt), /In worktree/);
  assert.equal(file(main.root), original);
});
