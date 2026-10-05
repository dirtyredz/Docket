// Registry persistence: missing/corrupt/unknown-version files, dry runs, and concurrent writers.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { readRegistry, updateRegistry } from "../../src/state/registry/store.mjs";
import { CLI, ROOT, makeRepo, tempDir } from "../helpers/repository.mjs";

const cleanups = [];
const tmp = () => {
  const t = tempDir("docket registry ");
  cleanups.push(t.cleanup);
  return t.dir;
};
after(() => cleanups.forEach((c) => c()));

const entry = {
  id: "r-00000001",
  alias: "one",
  commonDir: "/x/.git",
  preferred: "c-00000001",
  checkouts: [{ id: "c-00000001", path: "/x" }],
  docs: {},
};

describe("readRegistry", () => {
  test("a missing file reads as an empty version-1 registry", () => {
    const file = path.join(tmp(), "registry.json");
    assert.deepEqual(readRegistry(file), { version: 1, repos: [] });
    assert.equal(fs.existsSync(file), false);
  });

  test("corrupt JSON and an unknown version are DOCKET_INVALID", () => {
    const file = path.join(tmp(), "registry.json");
    for (const text of ["{ not json", '{"version":2,"repos":[]}', "[]", '{"version":1}']) {
      fs.writeFileSync(file, text);
      assert.throws(
        () => readRegistry(file),
        (err) => err.code === "DOCKET_INVALID",
        text,
      );
    }
  });
});

describe("updateRegistry", () => {
  test("a failed update leaves the file bytes unchanged", () => {
    const file = path.join(tmp(), "registry.json");
    for (const text of ["{ not json", '{"version":2,"repos":[]}']) {
      fs.writeFileSync(file, text);
      assert.throws(
        () => updateRegistry(file, (reg) => reg.repos.push(entry)),
        (err) => err.code === "DOCKET_INVALID",
      );
      assert.equal(fs.readFileSync(file, "utf8"), text);
    }
  });

  test("a change that makes the registry invalid is refused and nothing is written", () => {
    const file = path.join(tmp(), "registry.json");
    updateRegistry(file, (reg) => reg.repos.push(entry));
    const before = fs.readFileSync(file, "utf8");
    assert.throws(
      () => updateRegistry(file, (reg) => reg.repos.push({ ...entry, id: "r-00000002" })),
      (err) => err.code === "DOCKET_INVALID",
    );
    assert.equal(fs.readFileSync(file, "utf8"), before);
  });

  test("writes pretty JSON and reports written; a no-op change does not rewrite", () => {
    const file = path.join(tmp(), "registry.json");
    const first = updateRegistry(file, (reg) => reg.repos.push(entry));
    assert.equal(first.written, true);
    assert.match(fs.readFileSync(file, "utf8"), /^\{\n {2}"version": 1,/);
    const second = updateRegistry(file, () => {});
    assert.equal(second.written, false);
    assert.deepEqual(readRegistry(file).repos, [entry]);
  });

  test("dryRun computes the result but writes nothing", () => {
    const file = path.join(tmp(), "registry.json");
    const out = updateRegistry(file, (reg) => reg.repos.push(entry), { dryRun: true });
    assert.equal(out.written, false);
    assert.equal(out.registry.repos.length, 1);
    assert.equal(fs.existsSync(file), false);

    updateRegistry(file, (reg) => reg.repos.push(entry));
    const bytes = fs.readFileSync(file, "utf8");
    updateRegistry(file, (reg) => void (reg.repos.length = 0), { dryRun: true });
    assert.equal(fs.readFileSync(file, "utf8"), bytes);
  });
});

describe("concurrent writers", () => {
  test("six parallel `repo add` processes all land in the registry", async () => {
    const home = tmp();
    const repos = [];
    for (let i = 0; i < 6; i++) {
      const r = makeRepo({}, { prefix: `docket conc ${i} ` });
      cleanups.push(r.cleanup);
      fs.writeFileSync(path.join(r.root, "docket.json"), '{"version": 1}\n');
      repos.push(r);
    }
    const runs = repos.map(
      (r, i) =>
        new Promise((resolve) => {
          const child = spawn(
            process.execPath,
            [CLI, "repo", "add", r.root, "--alias", `conc-${i}`, "--json"],
            { cwd: ROOT, env: { ...process.env, DOCKET_HOME: home } },
          );
          let out = "";
          child.stdout.on("data", (d) => (out += d));
          child.on("close", (status) => resolve({ status, out }));
        }),
    );
    const results = await Promise.all(runs);
    for (const r of results) assert.equal(r.status, 0, r.out);
    const reg = readRegistry(path.join(home, "registry.json"));
    const expected = [0, 1, 2, 3, 4, 5].map((i) => `conc-${i}`);
    assert.deepEqual(reg.repos.map((r) => r.alias).sort(), expected);
  });
});
