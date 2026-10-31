// The one store-entry shape: storeEntry, listItemEntries and the snapshots built from them.
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { resolveRepo } from "../../../src/repository/context.mjs";
import { refSnapshot, workingSnapshot } from "../../../src/repository/snapshot.mjs";
import { listItemEntries, storeEntry } from "../../../src/storage/item-store.mjs";
import { revisionOf } from "../../../src/storage/revision.mjs";
import { git, itemText, makeRepo } from "../../helpers/repository.mjs";

const A = "dk-0000000a";
const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

const SHAPE = ["name", "isFile", "bytes", "revision"];

test("storeEntry hashes the bytes unless a revision is given", () => {
  const bytes = Buffer.from("x");
  assert.deepEqual(storeEntry("a.md", bytes), {
    name: "a.md",
    isFile: true,
    bytes,
    revision: revisionOf(bytes),
  });
  assert.equal(storeEntry("a.md", bytes, { revision: "r1" }).revision, "r1");
  assert.deepEqual(storeEntry("d", undefined, { isFile: false }), {
    name: "d",
    isFile: false,
    bytes: undefined,
    revision: undefined,
  });
});

test("working-tree and Git-ref snapshots hand parseEntries the same entry shape", () => {
  const repo = makeRepo({ [A]: itemText({ id: A }) });
  repos.push(repo);
  git(repo.root, "add", "-A");
  git(repo.root, "commit", "-qm", "items");
  const ctx = resolveRepo(repo.root);
  fs.mkdirSync(`${ctx.itemsDir}/sub`);
  const pick = (e) => Object.fromEntries(SHAPE.map((k) => [k, e[k]]));
  const working = workingSnapshot(ctx).entries;
  const [file] = working.filter((e) => e.isFile);
  assert.deepEqual(pick(file), pick(refSnapshot(ctx, "HEAD").entries[0]));
  assert.ok(file.path && typeof file.mtimeMs === "number" && typeof file.size === "number");
  const dir = working.find((e) => e.name === "sub");
  assert.equal(dir.isFile, false);
  assert.equal(dir.bytes, undefined);
});

test("listItemEntries without bytes keeps the stat facts and leaves bytes and revision out", () => {
  const repo = makeRepo({ [A]: itemText({ id: A }) });
  repos.push(repo);
  const [e] = listItemEntries(resolveRepo(repo.root), { withBytes: false });
  assert.equal(e.name, `${A}.md`);
  assert.equal(e.bytes, undefined);
  assert.equal(e.revision, undefined);
  assert.ok(e.size > 0);
});
