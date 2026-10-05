// One-shot discovery: scanForRepos / mergeDiscovered directly and through `docket repo scan`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { canonicalPath, pathKey } from "../../src/repository/canonical.mjs";
import { emptyRegistry } from "../../src/state/registry/schema.mjs";
import { mergeDiscovered, scanForRepos } from "../../src/state/registry/scan.mjs";
import { git, runCli, tempDir } from "../helpers/repository.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));

const sandbox = () => {
  const t = tempDir("docket scan ");
  cleanups.push(t.cleanup);
  return canonicalPath(t.dir);
};

/** A git repo at `dir` with a committed docket.json. */
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@docket");
  git(dir, "config", "user.name", "test");
  fs.writeFileSync(path.join(dir, "docket.json"), '{"version": 1}\n');
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return canonicalPath(dir);
}

const roots = (found) => found.candidates.map((c) => pathKey(c.root)).sort();
const keys = (...ps) => ps.map(pathKey).sort();

function cliEnv() {
  const home = tempDir("docket home ");
  cleanups.push(home.cleanup);
  const file = path.join(home.dir, "registry.json");
  const run = (...args) => runCli(["repo", ...args, "--json"], { env: { DOCKET_HOME: home.dir } });
  return { file, run };
}

describe("scanForRepos", () => {
  test("finds nested repos (B inside A's tree) and ignores node_modules", () => {
    const base = sandbox();
    const a = initRepo(path.join(base, "a"));
    const b = initRepo(path.join(a, "packages", "b"));
    initRepo(path.join(a, "node_modules", "dep"));
    assert.deepEqual(roots(scanForRepos(base)), keys(a, b));
  });

  test("a docket.json in an ordinary subdirectory is skipped and does not register the parent", () => {
    const base = sandbox();
    const a = initRepo(path.join(base, "a"));
    const sub = path.join(a, "docs", "nested");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "docket.json"), '{"version": 1}\n');
    const found = scanForRepos(path.join(a, "docs"));
    assert.deepEqual(found.candidates, []);
    assert.equal(found.skipped.length, 1);
    assert.match(found.skipped[0].reason, /below the checkout root/);
    // scanning from above still yields exactly the one real checkout
    assert.deepEqual(roots(scanForRepos(base)), keys(a));
  });

  test("a docket.json in a directory that is not a git repo is skipped with a reason", () => {
    const base = sandbox();
    fs.mkdirSync(path.join(base, "plain"));
    fs.writeFileSync(path.join(base, "plain", "docket.json"), '{"version": 1}\n');
    const found = scanForRepos(base);
    assert.deepEqual(found.candidates, []);
    assert.match(found.skipped[0].reason, /not usable/);
  });

  test("a directory link is reported and never followed (also a link loop)", (t) => {
    const base = sandbox();
    const a = initRepo(path.join(base, "a"));
    const target = path.join(base, "loop-target");
    fs.mkdirSync(target);
    const link = path.join(target, "back");
    const dirLink = path.join(base, "dirlink");
    try {
      fs.symlinkSync(base, link, process.platform === "win32" ? "junction" : "dir");
      fs.symlinkSync(a, dirLink, "dir");
    } catch (err) {
      if (err.code === "EPERM" || err.code === "EACCES") {
        t.skip(`cannot create links here: ${err.code}`);
        return;
      }
      throw err;
    }
    const found = scanForRepos(base);
    assert.deepEqual(roots(found), keys(a));
    const reasons = found.skipped.map((s) => `${s.path}|${s.reason}`);
    assert.ok(
      reasons.some((s) => s.includes("back|directory link")),
      reasons.join("\n"),
    );
    assert.ok(
      reasons.some((s) => s.includes("dirlink|directory link")),
      reasons.join("\n"),
    );
  });

  test("a scan root that does not exist fails with ENOENT instead of walking", () => {
    const gone = path.join(sandbox(), "missing");
    assert.throws(
      () => scanForRepos(gone),
      (err) => err.code === "ENOENT",
    );
  });

  test("the depth limit is reported", () => {
    const base = sandbox();
    fs.mkdirSync(path.join(base, "x", "y"), { recursive: true });
    const found = scanForRepos(base, { maxDepth: 1 });
    assert.ok(found.skipped.some((s) => /depth limit 1/.test(s.reason)));
  });
});

describe("build output skipping", () => {
  test("build and output folders are never entered or reported, however deep", () => {
    const base = sandbox();
    const a = initRepo(path.join(base, "a"));
    for (const name of [
      ".next",
      "dist",
      "build",
      "out",
      "coverage",
      ".turbo",
      ".cache",
      "target",
    ]) {
      fs.mkdirSync(path.join(a, name, ...Array(15).fill("d")), { recursive: true });
    }
    // a repo hiding inside build output is intentionally not found
    initRepo(path.join(a, "dist", "inner"));
    const found = scanForRepos(base);
    assert.deepEqual(roots(found), keys(a));
    assert.deepEqual(found.skipped, []);
  });

  test("worktrees under .claude/worktrees are still found", () => {
    const base = sandbox();
    const a = initRepo(path.join(base, "a"));
    const w = path.join(a, ".claude", "worktrees", "w1");
    git(a, "worktree", "add", "-q", "-b", "w1", w);
    assert.deepEqual(roots(scanForRepos(base)), keys(a, w));
  });
});

describe("mergeDiscovered", () => {
  test("a linked worktree under .claude/worktrees groups with its main checkout", () => {
    const base = sandbox();
    const a = initRepo(path.join(base, "a"));
    git(a, "worktree", "add", "-q", "-b", "wt", path.join(a, ".claude", "worktrees", "wt"));
    const found = scanForRepos(base);
    assert.equal(found.candidates.length, 2);
    const reg = emptyRegistry();
    const out = mergeDiscovered(reg, found);
    assert.equal(out.repos.length, 1);
    assert.equal(out.repos[0].change, "created");
    assert.equal(reg.repos.length, 1);
    const [repo] = reg.repos;
    assert.equal(repo.checkouts.length, 2);
    const preferred = repo.checkouts.find((c) => c.id === repo.preferred);
    assert.equal(pathKey(preferred.path), pathKey(a));
  });

  test("merging twice is unchanged and does not add duplicates", () => {
    const base = sandbox();
    initRepo(path.join(base, "a"));
    const reg = emptyRegistry();
    mergeDiscovered(reg, scanForRepos(base));
    const snapshot = JSON.stringify(reg);
    const again = mergeDiscovered(reg, scanForRepos(base));
    assert.equal(again.repos[0].change, "unchanged");
    assert.equal(JSON.stringify(reg), snapshot);
  });

  test("two independent repos named app get deterministic distinct aliases", () => {
    const base = sandbox();
    const one = initRepo(path.join(base, "alpha", "app"));
    const two = initRepo(path.join(base, "beta", "app"));
    const reg = emptyRegistry();
    const out = mergeDiscovered(reg, scanForRepos(base));
    const aliasOf = (p) => reg.repos.find((r) => pathKey(r.checkouts[0].path) === pathKey(p)).alias;
    assert.equal(aliasOf(one), "app");
    assert.equal(aliasOf(two), "app-beta");
    assert.deepEqual(
      out.aliases.map((a) => a.alias),
      ["app-beta"],
    );
  });
});

describe("repo scan output (CLI)", () => {
  const text = (...args) => {
    const home = tempDir("docket home ");
    cleanups.push(home.cleanup);
    return runCli(["repo", ...args], { env: { DOCKET_HOME: home.dir } });
  };

  function fixture() {
    const base = sandbox();
    const a = initRepo(path.join(base, "a"));
    initRepo(path.join(base, "b"));
    git(a, "worktree", "add", "-q", "-b", "w2", path.join(base, "w2"));
    fs.mkdirSync(path.join(base, "deep", ...Array(14).fill("d")), { recursive: true });
    fs.mkdirSync(path.join(a, ".next", "server", ...Array(14).fill("d")), { recursive: true });
    return base;
  }

  test("default output is one line per repo and a totals line; skips are counted, not listed", () => {
    const out = text("scan", fixture(), "--dry-run");
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const lines = out.stdout.trimEnd().split("\n");
    assert.match(lines[0], /^dry run, nothing written: scanned /);
    assert.equal(lines[1], "  a  new  2 checkouts");
    assert.equal(lines[2], "  b  new  1 checkout");
    assert.equal(lines[3], "2 repos (2 new), 3 checkouts; skipped 1 folder, use --verbose to list");
    assert.equal(lines.length, 4);
    assert.doesNotMatch(out.stdout, /depth limit|\.next|\+ /);
  });

  test("--verbose lists checkout paths and every skip with its reason", () => {
    const out = text("scan", fixture(), "--dry-run", "--verbose");
    assert.match(out.stdout, /^ {4}\+ .*w2$/m);
    assert.match(out.stdout, /^ {2}skipped .*: depth limit 12$/m);
    assert.match(out.stdout, /2 repos \(2 new\), 3 checkouts; skipped 1 folder$/m);
    assert.doesNotMatch(out.stdout, /\.next/);
  });

  test("a rescan reports existing and updated repos; --json keeps its shape", () => {
    const base = sandbox();
    const a = initRepo(path.join(base, "a"));
    initRepo(path.join(base, "b"));
    const home = tempDir("docket home ");
    cleanups.push(home.cleanup);
    const env = { DOCKET_HOME: home.dir };
    runCli(["repo", "scan", base], { env });
    git(a, "worktree", "add", "-q", "-b", "w2", path.join(base, "w2"));
    const out = runCli(["repo", "scan", base], { env });
    const lines = out.stdout.trimEnd().split("\n");
    assert.equal(lines[1], "  a  updated  2 checkouts");
    assert.equal(lines[2], "  b  existing  1 checkout");
    assert.equal(lines[3], "2 repos (1 updated, 1 existing), 3 checkouts");
    const json = runCli(["repo", "scan", base, "--json"], { env });
    assert.deepEqual(Object.keys(json.json.data).sort(), [
      "aliases",
      "dryRun",
      "repos",
      "root",
      "skipped",
    ]);
  });
});

describe("repo scan (CLI)", () => {
  test("registers, is idempotent, and leaves the registry bytes identical on repeat", () => {
    const base = sandbox();
    const a = initRepo(path.join(base, "a"));
    const b = initRepo(path.join(base, "b"));
    const { file, run } = cliEnv();
    const first = run("scan", base);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.deepEqual(
      first.json.data.repos.map((r) => r.change),
      ["created", "created"],
    );
    assert.equal(first.json.data.dryRun, false);
    assert.ok(Array.isArray(first.json.data.skipped));
    const bytes = fs.readFileSync(file);
    const second = run("scan", base);
    assert.deepEqual(
      second.json.data.repos.map((r) => r.change),
      ["unchanged", "unchanged"],
    );
    assert.deepEqual(fs.readFileSync(file), bytes);
    const listed = run("list")
      .json.data.repos.map((r) => pathKey(r.checkouts[0].path))
      .sort();
    assert.deepEqual(listed, keys(a, b));
  });

  test("--dry-run reports the repos but writes nothing", () => {
    const base = sandbox();
    initRepo(path.join(base, "a"));
    const { file, run } = cliEnv();
    const out = run("scan", base, "--dry-run");
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.equal(out.json.data.dryRun, true);
    assert.equal(out.json.data.repos.length, 1);
    assert.equal(fs.existsSync(file), false);

    run("scan", base);
    const bytes = fs.readFileSync(file);
    initRepo(path.join(base, "later"));
    const again = run("scan", base, "--dry-run");
    assert.equal(again.json.data.repos.length, 2);
    assert.deepEqual(fs.readFileSync(file), bytes);
  });

  test("existing alias and doc overrides are preserved", () => {
    const base = sandbox();
    const a = initRepo(path.join(base, "a"));
    const { run } = cliEnv();
    assert.equal(run("add", a, "--alias", "custom", "--doc", "GOTCHAS=g/G.md").status, 0);
    const out = run("scan", base);
    assert.equal(out.json.data.repos[0].change, "unchanged");
    const [repo] = run("list").json.data.repos;
    assert.equal(repo.alias, "custom");
    assert.deepEqual(repo.docs, { GOTCHAS: "g/G.md" });
  });

  test("a new worktree found by scan joins an existing registration, alias untouched", () => {
    const base = sandbox();
    const a = initRepo(path.join(base, "a"));
    const { run } = cliEnv();
    run("add", a, "--alias", "mine");
    git(a, "worktree", "add", "-q", "-b", "w2", path.join(base, "w2"));
    const out = run("scan", base);
    assert.equal(out.json.data.repos[0].change, "joined");
    assert.equal(out.json.data.repos[0].alias, "mine");
    assert.equal(run("list").json.data.repos[0].checkouts.length, 2);
  });

  test("basename collisions are reported in data.aliases", () => {
    const base = sandbox();
    initRepo(path.join(base, "alpha", "app"));
    initRepo(path.join(base, "beta", "app"));
    const { run } = cliEnv();
    const out = run("scan", base);
    assert.deepEqual(out.json.data.repos.map((r) => r.alias).sort(), ["app", "app-beta"]);
    assert.equal(out.json.data.aliases.length, 1);
    assert.equal(out.json.data.aliases[0].alias, "app-beta");
  });

  test("a missing directory is an error and nothing is written", () => {
    const base = sandbox();
    const { file, run } = cliEnv();
    const out = run("scan", path.join(base, "nope"));
    assert.notEqual(out.status, 0);
    assert.equal(fs.existsSync(file), false);
  });
});
