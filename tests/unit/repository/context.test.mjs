// Checkout context construction: contextFor builds the context from verified facts with no I/O, and
// contextAtRoot accepts only an exact checkout root (never an ancestor found by discovery).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CODES } from "../../../src/core/errors.mjs";
import { canonicalPath } from "../../../src/repository/canonical.mjs";
import { contextAtRoot, contextFor, resolveRepo } from "../../../src/repository/context.mjs";
import { tempDir } from "../../helpers/repository.mjs";
import { addWorktree, docketRepo } from "../../helpers/registry.mjs";

test("contextFor derives the item paths and omits gitDir unless given", () => {
  assert.deepEqual(contextFor("C:/x/repo", "C:/x/repo/.git"), {
    root: "C:/x/repo",
    commonDir: "C:/x/repo/.git",
    itemsDir: "C:/x/repo/docs/items",
    docketDir: "C:/x/repo/.docket",
    configPath: "C:/x/repo/docket.json",
  });
  assert.equal(contextFor("/r", "/r/.git", "/r/.git").gitDir, "/r/.git");
});

test("resolveRepo still discovers the enclosing checkout, with gitDir", (t) => {
  const r = docketRepo();
  t.after(r.cleanup);
  fs.mkdirSync(path.join(r.root, "sub"));
  const ctx = resolveRepo(path.join(r.root, "sub"));
  assert.equal(canonicalPath(ctx.root), canonicalPath(r.root));
  assert.ok(ctx.gitDir);
});

test("contextAtRoot returns canonical paths for an exact root, main or linked", (t) => {
  const r = docketRepo();
  t.after(r.cleanup);
  const ctx = contextAtRoot(r.root);
  assert.equal(ctx.root, canonicalPath(r.root));
  assert.equal(ctx.commonDir, canonicalPath(path.join(r.root, ".git")));
  assert.equal(ctx.gitDir, ctx.commonDir);
  assert.equal(ctx.itemsDir, `${ctx.root}/docs/items`);
  const wt = contextAtRoot(addWorktree(r));
  assert.equal(wt.commonDir, ctx.commonDir);
  assert.notEqual(wt.gitDir, wt.commonDir);
});

test("contextAtRoot refuses a subdirectory instead of using its ancestor checkout", (t) => {
  const r = docketRepo({ "dk-00000001": "x" });
  t.after(r.cleanup);
  assert.throws(
    () => contextAtRoot(path.join(r.root, "docs", "items")),
    (err) =>
      err.code === CODES.NOT_A_REPO &&
      /not a checkout root/.test(err.message) &&
      err.details.actual === canonicalPath(r.root),
  );
});

test("contextAtRoot refuses missing paths and folders outside any worktree", (t) => {
  const plain = tempDir("docket plain ");
  t.after(plain.cleanup);
  assert.throws(() => contextAtRoot(path.join(plain.dir, "nope")), { code: CODES.NOT_A_REPO });
  assert.throws(() => contextAtRoot(plain.dir), { code: CODES.NOT_A_REPO });
});
