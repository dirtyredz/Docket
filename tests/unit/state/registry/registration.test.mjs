// `docket repo add|list|remove` behaviour end to end through the CLI against a temp DOCKET_HOME.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { pathKey } from "../../../../src/repository/canonical.mjs";
import { git, makeRepo, runCli, tempDir } from "../../../helpers/repository.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));

/** A registrable repo (docket.json committed) plus its own registry home. */
function setup(opts) {
  const r = makeRepo({}, opts);
  const home = tempDir("docket home ");
  cleanups.push(r.cleanup, home.cleanup);
  fs.writeFileSync(path.join(r.root, "docket.json"), '{"version": 1}\n');
  r.commit("init");
  const env = { DOCKET_HOME: home.dir };
  const registryFile = path.join(home.dir, "registry.json");
  const cli = (...args) => runCli(["repo", ...args, "--json"], { env });
  return { ...r, env, registryFile, cli };
}

const worktree = (r, name = "wt1") => {
  const wt = path.join(r.dir, name);
  git(r.root, "worktree", "add", "-q", "-b", name, wt);
  return fs.realpathSync.native(wt).replaceAll("\\", "/");
};

describe("add", () => {
  test("registers a repo; human output says created; re-add is idempotent", () => {
    const r = setup();
    const human = runCli(["repo", "add", r.root], { env: r.env });
    assert.equal(human.status, 0, human.stderr);
    assert.match(human.stdout, /created/);
    const again = r.cli("add", r.root);
    assert.equal(again.status, 0, again.stdout);
    assert.equal(again.json.data.change, "unchanged");
    const reg = JSON.parse(fs.readFileSync(r.registryFile, "utf8"));
    assert.equal(reg.repos.length, 1);
    assert.equal(reg.repos[0].checkouts.length, 1);
  });

  test("the alias defaults to the directory basename, sanitised", () => {
    const r = setup();
    assert.equal(r.cli("add", r.root).json.data.repo.alias, "repo-with-space");
  });

  test("an alias collision is DOCKET_EXISTS (exit 3), also case-insensitively", () => {
    const a = setup();
    const b = makeRepo();
    cleanups.push(b.cleanup);
    fs.writeFileSync(path.join(b.root, "docket.json"), '{"version": 1}\n');
    assert.equal(a.cli("add", a.root, "--alias", "foo").status, 0);
    for (const alias of ["foo", "Foo", "FOO"]) {
      const out = runCli(["repo", "add", b.root, "--alias", alias, "--json"], { env: a.env });
      assert.equal(out.status, 3, alias);
      assert.equal(out.json.error.code, "DOCKET_EXISTS");
    }
  });

  test("an invalid alias is a usage error", () => {
    const r = setup();
    const out = r.cli("add", r.root, "--alias", "-bad name");
    assert.equal(out.status, 2);
    assert.equal(out.json.error.code, "DOCKET_USAGE");
  });

  test("--alias on re-add renames the repo", () => {
    const r = setup();
    r.cli("add", r.root, "--alias", "first");
    const out = r.cli("add", r.root, "--alias", "second");
    assert.equal(out.json.data.change, "updated");
    assert.equal(out.json.data.repo.alias, "second");
    assert.equal(r.cli("list").json.data.repos[0].alias, "second");
  });

  test("a /sub/.. spelling of the path yields the same single checkout", () => {
    const r = setup();
    fs.mkdirSync(path.join(r.root, "sub"));
    r.cli("add", r.root);
    const out = r.cli("add", `${r.root}/sub/..`);
    assert.equal(out.status, 0, out.stdout);
    assert.equal(out.json.data.change, "unchanged");
    assert.equal(r.cli("list").json.data.repos[0].checkouts.length, 1);
  });

  test(
    "a differently-cased path is the same checkout on Windows",
    { skip: process.platform !== "win32" },
    () => {
      const r = setup();
      r.cli("add", r.root);
      const out = r.cli("add", r.root.toUpperCase());
      assert.equal(out.status, 0, out.stdout);
      assert.equal(out.json.data.change, "unchanged");
      const [repo] = r.cli("list").json.data.repos;
      assert.equal(repo.checkouts.length, 1);
      assert.equal(pathKey(repo.checkouts[0].path), pathKey(r.root));
    },
  );

  test("spaces and Unicode in directory names register fine", () => {
    const r = setup({ prefix: "proj ü 名 " });
    const out = r.cli("add", r.root);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.equal(out.json.data.repo.alias, "repo-with-space");
    assert.equal(pathKey(out.json.data.checkout.path), pathKey(r.root));
  });

  test("a repo without docket.json is DOCKET_USAGE", () => {
    const r = makeRepo();
    const home = tempDir("docket home ");
    cleanups.push(r.cleanup, home.cleanup);
    const out = runCli(["repo", "add", r.root, "--json"], { env: { DOCKET_HOME: home.dir } });
    assert.equal(out.status, 2);
    assert.equal(out.json.error.code, "DOCKET_USAGE");
    assert.match(out.json.error.message, /docket\.json/);
    assert.equal(fs.existsSync(path.join(home.dir, "registry.json")), false);
  });

  test("a non-existent path is DOCKET_NOT_A_REPO", () => {
    const r = setup();
    const out = r.cli("add", path.join(r.dir, "does not exist"));
    assert.equal(out.status, 2);
    assert.equal(out.json.error.code, "DOCKET_NOT_A_REPO");
  });
});

describe("worktrees and clones", () => {
  test("a linked worktree joins the same repo and the preferred checkout is unchanged", () => {
    const r = setup();
    const first = r.cli("add", r.root);
    const out = r.cli("add", worktree(r));
    assert.equal(out.status, 0, out.stdout);
    assert.equal(out.json.data.change, "joined");
    const [repo] = r.cli("list").json.data.repos;
    assert.equal(repo.checkouts.length, 2);
    assert.equal(repo.checkouts.find((c) => c.preferred).id, first.json.data.checkout.id);
  });

  test("--preferred on the worktree switches the preferred checkout", () => {
    const r = setup();
    r.cli("add", r.root);
    const wt = worktree(r);
    r.cli("add", wt);
    const out = r.cli("add", wt, "--preferred");
    assert.equal(out.json.data.change, "updated");
    const [repo] = r.cli("list").json.data.repos;
    assert.equal(pathKey(repo.checkouts.find((c) => c.preferred).path), pathKey(wt));
  });

  test("an independent clone is a separate repo and needs its own alias", () => {
    const r = setup();
    const other = path.join(r.dir, "clone");
    git(r.dir, "clone", "-q", r.root, other);
    assert.equal(r.cli("add", r.root, "--alias", "origin-repo").status, 0);
    const out = r.cli("add", other, "--alias", "the-clone");
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.equal(out.json.data.change, "created");
    assert.equal(r.cli("list").json.data.repos.length, 2);
  });
});

describe("list", () => {
  test("a renamed checkout is listed unavailable with a reason; list never rewrites the file", () => {
    const r = setup();
    r.cli("add", r.root);
    const moved = `${r.root}-moved`;
    fs.renameSync(r.root, moved);
    const before = fs.readFileSync(r.registryFile);
    const out = r.cli("list");
    assert.equal(out.status, 0, out.stdout);
    const [repo] = out.json.data.repos;
    assert.equal(repo.checkouts.length, 1);
    assert.equal(repo.checkouts[0].available, false);
    assert.ok(repo.checkouts[0].reason);
    assert.deepEqual(fs.readFileSync(r.registryFile), before);
    fs.renameSync(moved, r.root);
    assert.equal(r.cli("list").json.data.repos[0].checkouts[0].available, true);
  });

  test("a deleted checkout stays registered and is flagged in the human output", () => {
    const r = setup();
    r.cli("add", r.root);
    fs.rmSync(r.root, { recursive: true, force: true });
    const human = runCli(["repo", "list"], { env: r.env });
    assert.match(human.stdout, /UNAVAILABLE/);
    assert.equal(r.cli("list").json.data.repos.length, 1);
  });
});

describe("remove", () => {
  test("removes the whole group (alias matched case-insensitively), files untouched", () => {
    const r = setup();
    r.cli("add", r.root);
    r.cli("add", worktree(r));
    const out = r.cli("remove", "REPO-WITH-SPACE");
    assert.equal(out.status, 0, out.stdout);
    assert.equal(out.json.data.removed, "repo");
    assert.equal(r.cli("list").json.data.repos.length, 0);
    assert.ok(fs.existsSync(path.join(r.root, "docket.json")));
  });

  test("an unknown alias is exit 4", () => {
    const r = setup();
    const out = r.cli("remove", "nope");
    assert.equal(out.status, 4);
    assert.equal(out.json.error.code, "DOCKET_NOT_FOUND");
  });

  test("--checkout removes one checkout; removing the preferred one reports the new preferred", () => {
    const r = setup();
    r.cli("add", r.root);
    const wt = worktree(r);
    r.cli("add", wt);
    const out = r.cli("remove", "repo-with-space", "--checkout", r.root);
    assert.equal(out.status, 0, out.stdout);
    assert.equal(out.json.data.removed, "checkout");
    assert.equal(pathKey(out.json.data.preferred.path), pathKey(wt));
    const [repo] = r.cli("list").json.data.repos;
    assert.equal(repo.checkouts.length, 1);
    assert.equal(repo.checkouts[0].preferred, true);
    const last = r.cli("remove", "repo-with-space", "--checkout", wt);
    assert.equal(last.json.data.removed, "repo");
    assert.equal(r.cli("list").json.data.repos.length, 0);
  });

  test("--checkout of a path that is not registered is exit 4", () => {
    const r = setup();
    r.cli("add", r.root);
    assert.equal(r.cli("remove", "repo-with-space", "--checkout", r.dir).status, 4);
  });
});

describe("--doc overrides", () => {
  const docsOf = (r) => r.cli("list").json.data.repos[0].docs;

  test("stores an override, replaces it, and `NAME=` removes it", () => {
    const r = setup();
    const out = r.cli("add", r.root, "--doc", "ARCHITECTURE=docs/arch/ARCHITECTURE.md");
    assert.equal(out.status, 0, out.stdout);
    assert.deepEqual(docsOf(r), { ARCHITECTURE: "docs/arch/ARCHITECTURE.md" });
    r.cli("add", r.root, "--doc", "architecture=arch.md", "--doc", "GOTCHAS=g.md");
    assert.deepEqual(docsOf(r), { ARCHITECTURE: "arch.md", GOTCHAS: "g.md" });
    const removed = r.cli("add", r.root, "--doc", "ARCHITECTURE=");
    assert.equal(removed.json.data.change, "updated");
    assert.deepEqual(docsOf(r), { GOTCHAS: "g.md" });
  });

  test("unknown names, escaping paths, absolute paths and non-Markdown fail DOCKET_USAGE", () => {
    const r = setup();
    const abs = path.resolve(r.dir, "a.md");
    for (const spec of [
      "X=a.md",
      "ARCHITECTURE=../a.md",
      `ARCHITECTURE=${abs}`,
      "ARCHITECTURE=/a.md",
      "ARCHITECTURE=a.txt",
      "ARCHITECTURE",
    ]) {
      const out = r.cli("add", r.root, "--doc", spec);
      assert.equal(out.status, 2, spec);
      assert.equal(out.json.error.code, "DOCKET_USAGE", spec);
    }
    assert.equal(fs.existsSync(r.registryFile), false);
  });
});
