// Registered-checkout verification, shared by the viewer and library consumers: checkout facts, why a
// registration is unavailable (gone, not a root, another clone, no docket.json), and the opener's
// verification cache, link checks and refusal to substitute another checkout.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CODES } from "../../../src/core/errors.mjs";
import { canonicalPath, sameKey } from "../../../src/repository/canonical.mjs";
import {
  createCheckoutOpener,
  inspectCheckout,
  unavailableReason,
} from "../../../src/repository/registered-checkout.mjs";
import { findCheckout } from "../../../src/state/registry/source.mjs";
import { readRegistry } from "../../../src/state/registry/store.mjs";
import { git, itemText, tempDir } from "../../helpers/repository.mjs";
import { addWorktree, appData, docketRepo, register } from "../../helpers/viewer.mjs";

const ITEM = itemText({ id: "dk-00000001" }, { title: "One" });

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

function registered(t, options = { alias: "scoped" }) {
  const data = appData();
  const r = docketRepo({ "dk-00000001": ITEM });
  t.after(() => {
    r.cleanup();
    data.cleanup();
  });
  const { repo, checkout } = register(data.registryFile, r.root, options);
  return { data, r, repo, checkout };
}

/** Make `root` a checkout of another clone (same path, still a root with docket.json). */
function rehome(t, root) {
  const other = docketRepo({}, { prefix: "docket other clone " });
  t.after(other.cleanup);
  fs.rmSync(root, { recursive: true, force: true });
  git(other.root, "worktree", "add", "-q", "-b", "rehomed", root);
}

test("inspectCheckout reports canonical root and common dir, and main versus linked", (t) => {
  const r = docketRepo({ "dk-00000001": ITEM });
  t.after(r.cleanup);
  const main = inspectCheckout(r.root);
  assert.equal(main.root, canonicalPath(r.root));
  assert.equal(main.commonDir, canonicalPath(path.join(r.root, ".git")));
  assert.equal(main.main, true);
  const wt = inspectCheckout(addWorktree(r));
  assert.equal(wt.main, false);
  assert.ok(sameKey(wt.commonDir, main.commonDir));
  assert.ok(!sameKey(wt.root, main.root));
});

test("inspectCheckout finds the enclosing root from a subdirectory (callers compare)", (t) => {
  const r = docketRepo({ "dk-00000001": ITEM });
  t.after(r.cleanup);
  const info = inspectCheckout(path.join(r.root, "docs", "items"));
  assert.ok(sameKey(info.root, r.root));
});

test("inspectCheckout refuses missing paths, non-repos and checkouts without docket.json", (t) => {
  const plain = tempDir("docket not a repo ");
  t.after(plain.cleanup);
  assert.throws(() => inspectCheckout(path.join(plain.dir, "nope")), { code: CODES.NOT_A_REPO });
  assert.throws(() => inspectCheckout(plain.dir), { code: CODES.NOT_A_REPO });
  const r = docketRepo();
  t.after(r.cleanup);
  fs.rmSync(path.join(r.root, "docket.json"));
  assert.throws(() => inspectCheckout(r.root), { code: CODES.USAGE, message: /no docket\.json/ });
  fs.writeFileSync(path.join(r.root, "docket.json"), '{"version": 99}\n');
  assert.throws(() => inspectCheckout(r.root), { code: CODES.USAGE });
});

test("unavailableReason: available, gone, not a root, another clone, no docket.json", (t) => {
  const { r, repo, checkout } = registered(t);
  assert.equal(unavailableReason(repo, checkout), null);
  const sub = { ...checkout, path: `${checkout.path}/docs` };
  assert.match(unavailableReason(repo, sub), /not a checkout root/);
  fs.renameSync(path.join(r.root, "docket.json"), path.join(r.root, "docket.off"));
  assert.match(unavailableReason(repo, checkout), /no docket\.json/);
  fs.renameSync(path.join(r.root, "docket.off"), path.join(r.root, "docket.json"));
  rehome(t, r.root);
  assert.equal(unavailableReason(repo, checkout), "now belongs to a different clone");
  fs.rmSync(r.root, { recursive: true, force: true });
  assert.equal(unavailableReason(repo, checkout), "path does not exist");
});

test("opener returns the core context for an available checkout", (t) => {
  const { repo, checkout } = registered(t);
  const ctx = createCheckoutOpener()(repo, checkout);
  assert.deepEqual(ctx, {
    root: checkout.path,
    commonDir: repo.commonDir,
    itemsDir: `${checkout.path}/docs/items`,
    docketDir: `${checkout.path}/.docket`,
    configPath: `${checkout.path}/docket.json`,
  });
});

test("opener refuses a deleted checkout, with the reason", (t) => {
  const { r, repo, checkout } = registered(t);
  const open = createCheckoutOpener();
  assert.equal(open(repo, checkout).root, checkout.path);
  fs.rmSync(r.root, { recursive: true, force: true });
  // Caught even inside the verification window: docket.json is checked on every open.
  assert.throws(
    () => open(repo, checkout),
    (err) =>
      err.code === CODES.NOT_FOUND &&
      /unavailable/.test(err.message) &&
      err.unavailable === "path does not exist",
  );
});

test("opener reuses a verification for reads within its window; fresh always re-verifies", (t) => {
  const { r, repo, checkout } = registered(t);
  let clock = 1000;
  const open = createCheckoutOpener({ now: () => clock });
  open(repo, checkout);
  rehome(t, r.root);
  assert.equal(open(repo, checkout).root, checkout.path, "cached read inside the window");
  assert.throws(() => open(repo, checkout, { fresh: true }), {
    code: CODES.NOT_FOUND,
    message: /different clone/,
  });
  // A failed verification is not cached as good.
  assert.throws(() => open(repo, checkout), { code: CODES.NOT_FOUND });
  clock += 10000;
  assert.throws(() => open(repo, checkout), { code: CODES.NOT_FOUND });
});

test("opener refuses a checkout whose items dir became a junction, even when cached", (t) => {
  const { r, repo, checkout } = registered(t);
  const outside = tempDir("docket outside ");
  t.after(outside.cleanup);
  fs.mkdirSync(path.join(outside.dir, "items"));
  const open = createCheckoutOpener();
  open(repo, checkout);
  fs.rmSync(path.join(r.root, "docs", "items"), { recursive: true });
  if (!link(path.join(outside.dir, "items"), path.join(r.root, "docs", "items"))) {
    return t.skip("cannot create links");
  }
  assert.throws(() => open(repo, checkout), { code: CODES.USAGE });
});

test("an unavailable preferred checkout is refused, never replaced by another", (t) => {
  const { data, r } = registered(t);
  const wt = addWorktree(r);
  register(data.registryFile, wt, { prefer: true });
  const registry = readRegistry(data.registryFile);
  const { repo, checkout } = findCheckout(registry, registry.repos[0].id);
  assert.ok(sameKey(checkout.path, wt), "the worktree is preferred");
  git(r.root, "worktree", "remove", "--force", wt);
  const open = createCheckoutOpener();
  assert.throws(() => open(repo, checkout), { code: CODES.NOT_FOUND });
  const main = repo.checkouts.find((c) => c.id !== checkout.id);
  assert.ok(sameKey(open(repo, main).root, r.root), "the other checkout opens only when named");
});
