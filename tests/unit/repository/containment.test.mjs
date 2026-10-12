// The checkout guard and its parts: lexical containment, real-path containment through links, link
// detection (junctions on Windows), and assertSafeCheckout over docket.json, .docket, the items directory
// and every item entry.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CODES } from "../../../src/core/errors.mjs";
import {
  assertRealWithin,
  assertSafeCheckout,
  isLink,
  lexicallyWithin,
  relativeInside,
} from "../../../src/repository/containment.mjs";
import { contextAtRoot } from "../../../src/repository/context.mjs";
import { itemText, tempDir } from "../../helpers/repository.mjs";
import { docketRepo, linkDir, linkFile } from "../../helpers/registry.mjs";

const ID = "dk-00000001";

function setup(t) {
  const r = docketRepo({ [ID]: itemText({ id: ID }) });
  const outside = tempDir("docket outside ");
  t.after(() => {
    r.cleanup();
    outside.cleanup();
  });
  return { r, outside: outside.dir, ctx: contextAtRoot(r.root) };
}

test("relativeInside keeps its registry behaviour (lexical, percent-decoded)", () => {
  assert.equal(relativeInside("docs/x.md"), "docs/x.md");
  for (const bad of ["../x", "/x", "C:/x", "a\\b", "a/%2e%2e/b", "a//b", ""]) {
    assert.throws(() => relativeInside(bad), { code: CODES.USAGE }, bad);
  }
});

test("lexicallyWithin compares by path key", () => {
  assert.ok(lexicallyWithin("/a/b", "/a/b"));
  assert.ok(lexicallyWithin("/a/b", "/a/b/c"));
  assert.ok(!lexicallyWithin("/a/b", "/a/bc"));
  assert.ok(!lexicallyWithin("/a/b", "/a"));
});

test("a clean checkout passes; missing .docket and items directory are fine", (t) => {
  const { r, ctx } = setup(t);
  assertSafeCheckout(ctx);
  fs.rmSync(path.join(r.root, "docs"), { recursive: true });
  assertSafeCheckout(ctx);
});

test("a junctioned items directory is refused", (t) => {
  const { r, outside, ctx } = setup(t);
  fs.mkdirSync(path.join(outside, "items"));
  fs.rmSync(path.join(r.root, "docs", "items"), { recursive: true });
  if (!linkDir(path.join(outside, "items"), path.join(r.root, "docs", "items")))
    return t.skip("cannot create links");
  assert.ok(isLink(ctx.itemsDir));
  assert.throws(() => assertSafeCheckout(ctx), { code: CODES.USAGE, message: /link/ });
});

test("a linked parent (docs/) that escapes the checkout is refused by real path", (t) => {
  const { r, outside, ctx } = setup(t);
  fs.mkdirSync(path.join(outside, "docs", "items"), { recursive: true });
  fs.rmSync(path.join(r.root, "docs"), { recursive: true });
  if (!linkDir(path.join(outside, "docs"), path.join(r.root, "docs")))
    return t.skip("cannot create links");
  assert.equal(isLink(ctx.itemsDir), false, "the items dir itself is a real directory");
  assert.throws(() => assertSafeCheckout(ctx), { code: CODES.USAGE, message: /escapes/ });
  assert.throws(() => assertRealWithin(ctx.root, ctx.itemsDir), { code: CODES.USAGE });
});

test("a linked .docket directory is refused", (t) => {
  const { r, outside, ctx } = setup(t);
  if (!linkDir(outside, path.join(r.root, ".docket"))) return t.skip("cannot create links");
  assert.throws(() => assertSafeCheckout(ctx), { code: CODES.USAGE });
});

test("a junction among the item entries is refused", (t) => {
  const { r, outside, ctx } = setup(t);
  if (!linkDir(outside, path.join(r.root, "docs", "items", "dk-0000dead.md")))
    return t.skip("cannot create links");
  assert.throws(() => assertSafeCheckout(ctx), {
    code: CODES.USAGE,
    message: /dk-0000dead\.md/,
  });
});

test("a symlinked item file or docket.json is refused where the platform allows file links", (t) => {
  const { r, outside, ctx } = setup(t);
  const target = path.join(outside, "x.md");
  fs.writeFileSync(target, itemText({ id: "dk-0000beef" }));
  if (!linkFile(target, path.join(r.root, "docs", "items", "dk-0000beef.md")))
    return t.skip("file symlinks need a privilege here");
  assert.throws(() => assertSafeCheckout(ctx), { code: CODES.USAGE });
  fs.rmSync(path.join(r.root, "docs", "items", "dk-0000beef.md"));
  fs.writeFileSync(path.join(outside, "docket.json"), '{"version": 1}\n');
  fs.rmSync(ctx.configPath);
  assert.ok(linkFile(path.join(outside, "docket.json"), ctx.configPath));
  assert.throws(() => assertSafeCheckout(ctx), { code: CODES.USAGE });
});
