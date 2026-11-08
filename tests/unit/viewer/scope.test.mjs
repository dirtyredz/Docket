import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  assertSafeCheckout,
  lexicallyWithin,
  relativeInside,
} from "../../../src/repository/containment.mjs";
import { CODES } from "../../../src/core/errors.mjs";
import { contextFor } from "../../../src/repository/context.mjs";
import { createCheckoutOpener } from "../../../src/repository/registered-checkout.mjs";
import { createRegistrySource } from "../../../src/state/registry/source.mjs";
import { checkItemId, mutateScoped, openScoped } from "../../../src/viewer/server/scope.mjs";
import { itemText, tempDir } from "../../helpers/repository.mjs";
import { appData, docketRepo, register } from "../../helpers/viewer.mjs";

/** Create a directory link; returns false when the platform refuses (no privilege). */
function link(target, p) {
  try {
    fs.symlinkSync(target, p, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch (err) {
    if (err.code === "EPERM" || err.code === "EACCES") return false;
    throw err;
  }
}

const ITEM = itemText({ id: "dk-00000001" }, { title: "One" });

test("relativeInside accepts plain relative paths", () => {
  assert.equal(relativeInside("docs/a.md"), "docs/a.md");
  assert.equal(relativeInside("a b/ü.md"), "a b/ü.md");
});

test("relativeInside rejects escapes", () => {
  const bad = [
    "",
    "/abs",
    "C:/x",
    "C:x",
    "\\\\server\\share",
    "a\\b",
    "../a",
    "a/../b",
    "a//b",
    "./a",
    "%2e%2e/a",
    "a%2f..%2fb",
    "a\0b",
    "%00",
    "%zz",
    null,
    undefined,
  ];
  for (const p of bad) {
    assert.throws(() => relativeInside(p), { code: CODES.USAGE }, JSON.stringify(p));
  }
});

test("lexicallyWithin", () => {
  const { dir, cleanup } = tempDir();
  try {
    assert.equal(lexicallyWithin(dir, dir), true);
    assert.equal(lexicallyWithin(dir, path.join(dir, "a", "b")), true);
    assert.equal(lexicallyWithin(dir, `${dir}-sibling`), false);
    assert.equal(lexicallyWithin(path.join(dir, "a"), dir), false);
  } finally {
    cleanup();
  }
});

function ctxFor(root) {
  return {
    root,
    itemsDir: `${root}/docs/items`,
    docketDir: `${root}/.docket`,
    configPath: `${root}/docket.json`,
  };
}

test("assertSafeCheckout passes a plain checkout", (t) => {
  const r = docketRepo({ "dk-00000001": ITEM });
  t.after(r.cleanup);
  assertSafeCheckout(ctxFor(r.root));
});

test("assertSafeCheckout rejects linked items dir, entries and .docket", (t) => {
  const outside = tempDir("docket outside ");
  t.after(outside.cleanup);
  fs.mkdirSync(path.join(outside.dir, "items"));
  fs.writeFileSync(path.join(outside.dir, "items", "dk-00000009.md"), ITEM);

  // items dir is a junction
  const a = docketRepo({ "dk-00000001": ITEM });
  t.after(a.cleanup);
  fs.rmSync(path.join(a.root, "docs", "items"), { recursive: true });
  if (!link(path.join(outside.dir, "items"), path.join(a.root, "docs", "items"))) {
    return t.skip("cannot create links");
  }
  assert.throws(() => assertSafeCheckout(ctxFor(a.root)), { code: CODES.USAGE });

  // an item entry is a symlink
  const b = docketRepo({ "dk-00000001": ITEM });
  t.after(b.cleanup);
  const entry = path.join(b.root, "docs", "items", "dk-00000002.md");
  try {
    fs.symlinkSync(path.join(outside.dir, "items", "dk-00000009.md"), entry, "file");
    assert.throws(() => assertSafeCheckout(ctxFor(b.root)), { code: CODES.USAGE });
  } catch (err) {
    if (err.code !== "EPERM") throw err;
  }

  // .docket is a junction
  const c = docketRepo({ "dk-00000001": ITEM });
  t.after(c.cleanup);
  if (link(outside.dir, path.join(c.root, ".docket"))) {
    assert.throws(() => assertSafeCheckout(ctxFor(c.root)), { code: CODES.USAGE });
  }
});

test("checkItemId", () => {
  assert.throws(() => checkItemId("../x"), { code: CODES.USAGE });
  assert.throws(() => checkItemId("dk-xyz"), { code: CODES.USAGE });
  assert.throws(() => checkItemId(undefined), { code: CODES.USAGE });
  assert.equal(checkItemId("dk-0000abcd"), "dk-0000abcd");
  assert.equal(checkItemId("bl-0000abcd"), "bl-0000abcd");
});

function registered(t) {
  const data = appData();
  const r = docketRepo({ "dk-00000001": ITEM });
  t.after(() => {
    r.cleanup();
    data.cleanup();
  });
  const { repo, checkout } = register(data.registryFile, r.root, { alias: "scoped" });
  const deps = {
    registrySource: createRegistrySource(data.registryFile),
    openCheckout: createCheckoutOpener(),
  };
  return { data, r, repo, checkout, deps };
}

// The viewer adapter binds route params to the shared registry source, lookup and opener.
test("openScoped resolves registry ids (preferred by default) to an opened checkout", (t) => {
  const { repo, checkout, deps } = registered(t);
  const out = openScoped(deps, { repo: repo.id });
  assert.equal(out.checkout.id, checkout.id);
  assert.equal(out.ctx.root, checkout.path);
  assert.equal(openScoped(deps, { repo: repo.id, checkout: checkout.id }).repo.id, repo.id);
  assert.throws(() => openScoped(deps, { repo: "../x" }), { code: CODES.USAGE });
  assert.throws(() => openScoped(deps, { repo: repo.id, checkout: "c-00000000" }), {
    code: CODES.NOT_FOUND,
  });
});

test("mutateScoped checks the item id, opens fresh and invalidates the catalog entry", (t) => {
  const { r, repo, checkout, deps } = registered(t);
  const invalidated = [];
  const all = { ...deps, catalog: { invalidate: (a, b) => invalidated.push([a.id, b.id]) } };
  const params = { repo: repo.id, checkout: checkout.id, id: "dk-00000001" };
  assert.equal(
    mutateScoped(all, params, (ctx, id) => `${ctx.root}|${id}`),
    `${checkout.path}|dk-00000001`,
  );
  assert.deepEqual(invalidated, [[repo.id, checkout.id]]);
  assert.throws(() => mutateScoped(all, { ...params, id: "../x" }, () => 1), {
    code: CODES.USAGE,
  });
  openScoped(deps, params); // cache a read verification, then lose the checkout
  fs.rmSync(path.join(r.root, ".git"), { recursive: true, force: true });
  assert.throws(() => mutateScoped(all, params, () => 1), { code: CODES.NOT_FOUND });
  assert.equal(invalidated.length, 1);
});

test("contextFor builds the checkout context, with gitDir only when known", () => {
  assert.deepEqual(contextFor("C:/r", "C:/r/.git"), {
    root: "C:/r",
    commonDir: "C:/r/.git",
    itemsDir: "C:/r/docs/items",
    docketDir: "C:/r/.docket",
    configPath: "C:/r/docket.json",
  });
  assert.equal(contextFor("C:/r", "C:/r/.git", "C:/r/.git").gitDir, "C:/r/.git");
});
