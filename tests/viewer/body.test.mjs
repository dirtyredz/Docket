// Viewer facts-body editing: POST .../items/:id/body, checked against the files on disk.
import assert from "node:assert/strict";
import { test } from "node:test";
import { itemText, readItem } from "../helpers/repository.mjs";
import { appData, docketRepo, register, viewer } from "../helpers/viewer.mjs";

const A = "dk-00000001";
const REF = "2026-10-05T14:03:00.000Z";
const NOTES = `\n## Notes\n\n### ${REF} · open · owner\n\nQuestion.\n`;
const item = (id, { notes = "" } = {}) =>
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
  return { v, r, base, detail };
}

/** Frontmatter + H1 (everything before the facts) and the Notes suffix of an item file. */
const parts = (text) => ({
  head: text.slice(0, text.indexOf("\n", text.indexOf("\n# ") + 1)),
  notes: text.includes("\n## Notes") ? text.slice(text.indexOf("\n## Notes")) : "",
});

test("body save rewrites facts and keeps frontmatter, H1 and Notes bytes", async (t) => {
  const { v, r, base, detail } = await start(t, { [A]: item(A, { notes: NOTES }) });
  const before = readItem(r.root, A);
  const d = await detail();
  assert.equal(d.body, "Facts.\n");
  assert.ok(!d.body.includes("Question."));
  const res = await v.post(`${base}/${A}/body`, {
    expected: d.revision,
    body: "\nNew facts.\n\n- one\n",
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.id, A);
  assert.equal(res.json.noop, false);
  assert.ok(res.json.revision);
  const after = readItem(r.root, A);
  assert.equal(parts(after).head, parts(before).head);
  assert.ok(parts(before).notes.length > 0);
  assert.equal(parts(after).notes, parts(before).notes);
  assert.match(after, /New facts\./);
  const next = await detail();
  assert.equal(next.revision, res.json.revision);
  assert.equal(next.body, "New facts.\n\n- one\n");
  assert.equal(next.notes.length, 1);
  assert.equal(next.openNoteCount, 1);
});

test("an unchanged body at the current revision is a 200 noop", async (t) => {
  const { v, r, base, detail } = await start(t, { [A]: item(A) });
  const d = await detail();
  const before = readItem(r.root, A);
  const res = await v.post(`${base}/${A}/body`, { expected: d.revision, body: d.bodySource });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.noop, true);
  assert.equal(readItem(r.root, A), before);
});

test("validation: 400 for missing expected, extra keys and non-string body", async (t) => {
  const { v, r, base, detail } = await start(t, { [A]: item(A) });
  const before = readItem(r.root, A);
  const { revision } = await detail();
  const bad = [
    ["missing expected", { body: "x\n" }],
    ["empty expected", { expected: "", body: "x\n" }],
    ["extra key", { expected: revision, body: "x\n", title: "t" }],
    ["non-string body", { expected: revision, body: 5 }],
    ["missing body", { expected: revision }],
  ];
  for (const [name, body] of bad) {
    const res = await v.post(`${base}/${A}/body`, body);
    assert.equal(res.status, 400, `${name}: ${res.text}`);
  }
  assert.equal(readItem(r.root, A), before);
});

test("stale expected is a 409, including for an unchanged body", async (t) => {
  const { v, r, base, detail } = await start(t, { [A]: item(A) });
  const old = await detail();
  const ok = await v.post(`${base}/${A}/body`, { expected: old.revision, body: "\nChanged.\n" });
  assert.equal(ok.status, 200, ok.text);
  const onDisk = readItem(r.root, A);
  const stale = await v.post(`${base}/${A}/body`, { expected: old.revision, body: "\nOther.\n" });
  assert.equal(stale.status, 409, stale.text);
  const staleNoop = await v.post(`${base}/${A}/body`, {
    expected: old.revision,
    body: "\nChanged.\n",
  });
  assert.equal(staleNoop.status, 409, staleNoop.text);
  assert.equal(readItem(r.root, A), onDisk);
});

test("a body containing a Notes heading is 422 and leaves the file unchanged", async (t) => {
  const { v, r, base, detail } = await start(t, { [A]: item(A, { notes: NOTES }) });
  const before = readItem(r.root, A);
  const { revision } = await detail();
  const res = await v.post(`${base}/${A}/body`, {
    expected: revision,
    body: "\nFacts.\n\n## Notes\n\nsneaky\n",
  });
  assert.equal(res.status, 422, res.text);
  assert.equal(readItem(r.root, A), before);
});

test("a body POST without the CSRF token is refused and writes nothing", async (t) => {
  const { v, r, base, detail } = await start(t, { [A]: item(A) });
  const before = readItem(r.root, A);
  const { revision } = await detail();
  const res = await v.post(
    `${base}/${A}/body`,
    { expected: revision, body: "\nNope.\n" },
    { token: null },
  );
  assert.ok(res.status >= 400 && res.status < 500, res.text);
  assert.equal(readItem(r.root, A), before);
});
