// The last-good registry source (long-lived readers: the viewer, library consumers) and id lookup.
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
    assert.match(broken.error, /not valid JSON/);
    assert.equal(broken.missing, false);
    fs.writeFileSync(file, '{"version": 2, "repos": []}');
    assert.match(source.get().error, /unsupported version/);
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
    assert.throws(() => findCheckout(registry, "r-0000000f"), { code: CODES.NOT_FOUND });
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
