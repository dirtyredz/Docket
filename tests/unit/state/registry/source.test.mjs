// The last-good registry source (long-lived readers: Command Deck's Docket worker, other library
// consumers), its forced refresh, and strict id lookup.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CODES } from "../../../../src/core/errors.mjs";
import { createRegistrySource, findCheckout } from "../../../../src/state/registry/source.mjs";
import { tempDir } from "../../../helpers/repository.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const registryFile = () => {
  const t = tempDir("docket registry source ");
  cleanups.push(t.cleanup);
  return path.join(t.dir, "registry.json");
};

const repo = (n, checkouts = 1) => ({
  id: `r-0000000${n}`,
  alias: `repo${n}`,
  commonDir: `/x${n}/.git`,
  preferred: `c-${n}0000001`,
  checkouts: Array.from({ length: checkouts }, (_, i) => ({
    id: `c-${n}000000${i + 1}`,
    path: `/x${n}/wt${i}`,
  })),
  docs: {},
});
const doc = (...repos) => `${JSON.stringify({ version: 1, repos }, null, 2)}\n`;

describe("createRegistrySource", () => {
  test("a missing registry is empty and says so", () => {
    const source = createRegistrySource(registryFile());
    assert.deepEqual(source.get(), {
      registry: { version: 1, repos: [] },
      error: null,
      missing: true,
    });
  });

  test("registrations made while the reader runs appear without a restart", () => {
    const file = registryFile();
    const source = createRegistrySource(file);
    assert.equal(source.get().registry.repos.length, 0);
    fs.writeFileSync(file, doc(repo(1)));
    const got = source.get();
    assert.equal(got.missing, false);
    assert.equal(got.error, null);
    assert.deepEqual(
      got.registry.repos.map((r) => r.alias),
      ["repo1"],
    );
    fs.writeFileSync(file, doc(repo(1), repo(2)));
    assert.equal(source.get().registry.repos.length, 2);
  });

  test("a broken registry keeps serving the last good document, with the error", () => {
    const file = registryFile();
    fs.writeFileSync(file, doc(repo(1)));
    const source = createRegistrySource(file);
    const good = source.get().registry;
    fs.writeFileSync(file, "{ not json");
    const broken = source.get();
    assert.equal(broken.registry, good);
    assert.equal(broken.error.code, CODES.INVALID);
    assert.match(broken.error.message, /not valid JSON/);
    assert.equal(broken.missing, false);
    fs.writeFileSync(file, '{"version": 2, "repos": []}');
    assert.match(source.get().error.message, /unsupported version/);
    assert.equal(source.get().registry, good);
    fs.writeFileSync(file, doc(repo(1), repo(2)));
    const fixed = source.get();
    assert.equal(fixed.error, null);
    assert.equal(fixed.registry.repos.length, 2);
  });

  test("a registry that is broken from the start serves an empty registry and the error", () => {
    const file = registryFile();
    fs.writeFileSync(file, "[]");
    const got = createRegistrySource(file).get();
    assert.deepEqual(got.registry, { version: 1, repos: [] });
    assert.ok(got.error);
  });

  test("an unchanged file is not re-read", () => {
    const file = registryFile();
    fs.writeFileSync(file, doc(repo(1)));
    const source = createRegistrySource(file);
    assert.equal(source.get(), source.get());
  });

  test("a forced refresh re-reads a rewrite the size/mtime stamp cannot see", () => {
    const file = registryFile();
    const mtime = new Date("2026-01-01T00:00:00Z"); // whole seconds: utimes round-trips it exactly
    fs.writeFileSync(file, doc(repo(1)));
    fs.utimesSync(file, mtime, mtime);
    const source = createRegistrySource(file);
    assert.equal(source.get().registry.repos[0].alias, "repo1");
    // Same size, same mtime: invisible to the stamp.
    fs.writeFileSync(file, doc(repo(1)).replace("repo1", "repoX"));
    fs.utimesSync(file, mtime, mtime);
    assert.equal(source.get().registry.repos[0].alias, "repo1", "stamp unchanged: cached");
    assert.equal(source.get({ refresh: true }).registry.repos[0].alias, "repoX");
    assert.equal(source.get().registry.repos[0].alias, "repoX");
  });

  test("a forced refresh of a broken file keeps the last good document and reports the error", () => {
    const file = registryFile();
    const mtime = new Date("2026-01-01T00:00:00Z");
    fs.writeFileSync(file, doc(repo(1)));
    fs.utimesSync(file, mtime, mtime);
    const source = createRegistrySource(file);
    const good = source.get().registry;
    const broken = doc(repo(1)).replace("{", "[");
    fs.writeFileSync(file, broken);
    fs.utimesSync(file, mtime, mtime);
    const got = source.get({ refresh: true });
    assert.equal(got.registry, good);
    assert.ok(got.error);
  });
});

describe("findCheckout", () => {
  const registry = { version: 1, repos: [repo(1, 2), repo(2)] };

  test("defaults to the preferred checkout and finds an explicit one", () => {
    const a = findCheckout(registry, "r-00000001");
    assert.equal(a.repo.alias, "repo1");
    assert.equal(a.checkout.id, "c-10000001");
    assert.equal(findCheckout(registry, "r-00000001", "c-10000002").checkout.path, "/x1/wt1");
  });

  test("malformed ids are DOCKET_USAGE, unknown ones DOCKET_NOT_FOUND", () => {
    for (const [r, c] of [
      ["../x", undefined],
      ["", undefined],
      [undefined, undefined],
      ["r-00000001", "../x"],
      ["r-00000001", "nope"],
    ]) {
      assert.throws(() => findCheckout(registry, r, c), { code: CODES.USAGE }, `${r} ${c}`);
    }
    assert.throws(
      () => findCheckout(registry, "r-0000000f"),
      (err) => err.code === CODES.NOT_FOUND && err.details.repo === "r-0000000f",
    );
    assert.throws(() => findCheckout(registry, "r-00000001", "c-00000000"), {
      code: CODES.NOT_FOUND,
    });
  });

  test("a checkout of another repo is never found through this one", () => {
    assert.throws(() => findCheckout(registry, "r-00000001", "c-20000001"), {
      code: CODES.NOT_FOUND,
    });
  });
});
