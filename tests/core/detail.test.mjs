// readItem builds fields, title, body, errors and revision from the same freshly read bytes; the index
// only supplies the surrounding records for relations.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { readItem } from "../../src/core/items/detail.mjs";
import { resolveRepo } from "../../src/repository/context.mjs";
import { loadIndex } from "../../src/state/index/build.mjs";
import { revisionOf } from "../../src/storage/revision.mjs";
import { itemText, makeRepo } from "../helpers/repository.mjs";

const A = "dk-0000a001";
const B = "dk-0000b002";
const noClaims = { readClaims: () => ({ claims: {} }) };
const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

function setup(items) {
  const r = makeRepo(items);
  repos.push(r);
  return { r, ctx: resolveRepo(r.root) };
}

test("a file changed after indexing is described by its new bytes", () => {
  const { r, ctx } = setup({ [A]: itemText({ id: A, status: "todo" }, { title: "Old" }) });
  const { records } = loadIndex(ctx);
  const text = itemText(
    { id: A, status: "wip", priority: "P0" },
    { title: "New", body: "Fresh.\n" },
  );
  r.write(A, text);
  const { data, content } = readItem(ctx, A, { records, claims: noClaims });
  assert.equal(content, text);
  assert.equal(data.title, "New");
  assert.equal(data.status, "wip");
  assert.equal(data.priority, "P0");
  assert.equal(data.revision, revisionOf(Buffer.from(text)));
  assert.match(data.body, /Fresh\./);
});

test("a file added after indexing is readable without an index entry", () => {
  const { r, ctx } = setup({ [A]: itemText({ id: A }) });
  const { records } = loadIndex(ctx);
  r.write(B, itemText({ id: B, relates: [A] }, { title: "Added" }));
  const { data } = readItem(ctx, B, { records, claims: noClaims });
  assert.equal(data.title, "Added");
  assert.deepEqual(data.relates, [A]);
});

test("reverse relations use the fresh record of the selected item", () => {
  const { r, ctx } = setup({
    [A]: itemText({ id: A }),
    [B]: itemText({ id: B, rank: "b" }),
  });
  const { records } = loadIndex(ctx);
  r.write(A, itemText({ id: A, relates: [B] }));
  const { data } = readItem(ctx, A, { records, claims: noClaims });
  assert.deepEqual(data.reverse.relates, [B]);
});

test("a malformed file reports its errors instead of stale indexed fields", () => {
  const { r, ctx } = setup({ [A]: itemText({ id: A }, { title: "Was fine" }) });
  const { records } = loadIndex(ctx);
  fs.writeFileSync(path.join(r.root, "docs", "items", `${A}.md`), "not an item\n");
  const { data } = readItem(ctx, A, { records, claims: noClaims });
  assert.equal(data.title, null);
  assert.equal(data.status, undefined);
  assert.ok(data.errors.length > 0);
});

test("a missing file is not found even when the index still lists it", () => {
  const { r, ctx } = setup({ [A]: itemText({ id: A }) });
  const { records } = loadIndex(ctx);
  fs.rmSync(path.join(r.root, "docs", "items", `${A}.md`));
  assert.throws(() => readItem(ctx, A, { records, claims: noClaims }), {
    code: "DOCKET_NOT_FOUND",
  });
});
