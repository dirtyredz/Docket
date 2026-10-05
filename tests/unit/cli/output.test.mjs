// Output contract: JSON envelope, human streams, exit codes, global flags.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { git, itemText, makeRepo, ROOT, runCli } from "../../helpers/repository.mjs";

const A = "dk-aaaaaaaa";
const B = "dk-bbbbbbbb";
const repos = [];
const repo = (items) => {
  const r = makeRepo(items);
  repos.push(r);
  return r;
};
after(() => repos.forEach((r) => r.cleanup()));

const sorted = (o) => Object.keys(o).sort();

describe("json envelope", () => {
  test("success has exactly ok, command, data, warnings", () => {
    const r = repo({ [A]: itemText({ id: A }) });
    const out = runCli(["list", "--json", "--repo", r.root]);
    assert.equal(out.status, 0);
    assert.deepEqual(sorted(out.json), ["command", "data", "ok", "warnings"]);
    assert.equal(out.json.ok, true);
    assert.equal(out.json.command, "list");
    assert.ok(Array.isArray(out.json.warnings));
    assert.ok(out.stdout.endsWith("}\n") && out.stdout.trimEnd().split("\n").length === 1);
    assert.equal(out.stderr, "");
  });

  test("failed check is one document with empty stderr", () => {
    const r = repo({ [A]: itemText({ id: B }) });
    const out = runCli(["check", "--json", "--repo", r.root]);
    assert.equal(out.status, 1);
    assert.ok(out.json, "stdout parses as JSON");
    assert.equal(out.json.command, "check");
    assert.equal(out.json.ok, false);
    assert.ok(out.stdout.endsWith("\n"));
    assert.equal(out.stderr, "");
  });

  test("usage error has ok false, command and error{code,message}", () => {
    const r = repo();
    const out = runCli(["add", "--json", "--repo", r.root]);
    assert.equal(out.status, 2);
    assert.deepEqual(sorted(out.json), ["command", "error", "ok"]);
    assert.equal(out.json.ok, false);
    assert.equal(out.json.command, "add");
    assert.equal(out.json.error.code, "DOCKET_USAGE");
    assert.equal(typeof out.json.error.message, "string");
    assert.ok(sorted(out.json.error).every((k) => ["code", "message", "details"].includes(k)));
    assert.equal(out.stderr, "");
    assert.equal(out.stdout.trimEnd().split("\n").length, 1);
  });

  test("not-found error carries details", () => {
    const r = repo();
    const out = runCli(["show", "dk-ffffffff", "--json", "--repo", r.root]);
    assert.equal(out.status, 4);
    assert.equal(out.json.error.code, "DOCKET_NOT_FOUND");
    assert.ok(out.json.error.details);
  });
});

describe("human mode", () => {
  test("warnings go to stderr, results to stdout", () => {
    const r = repo({ [A]: itemText({ id: A, status: "wip" }) });
    const out = runCli(["check", "--repo", r.root]);
    assert.equal(out.status, 0);
    assert.match(out.stdout, /docket check/);
    assert.match(out.stderr, /^warning: /m);
    assert.doesNotMatch(out.stdout, /warning:/);
  });

  test("errors go to stderr with empty stdout", () => {
    const r = repo();
    const out = runCli(["show", "dk-ffffffff", "--repo", r.root]);
    assert.equal(out.status, 4);
    assert.equal(out.stdout, "");
    assert.match(out.stderr, /docket show: /);
  });
});

describe("exit codes", () => {
  test("check passes on a valid store", () => {
    const r = repo({ [A]: itemText({ id: A }) });
    assert.equal(runCli(["check", "--repo", r.root]).status, 0);
  });

  test("usage errors exit 2", () => {
    const r = repo({ [A]: itemText({ id: A }) });
    const base = ["--repo", r.root];
    const cases = [
      ["frobnicate"],
      ["list", "--bogus"],
      ["add", "--type", "task", "--priority", "P1", ...base],
      ["add", "--type", "task", "--priority", "P9", "--title", "x", ...base],
      ["set", A, "--top", "--bottom", ...base],
    ];
    for (const args of cases) {
      const out = runCli([...args, ...(args.includes("--repo") ? [] : base)]);
      assert.equal(out.status, 2, args.join(" "));
    }
  });

  test("stale --expect exits 3 with DOCKET_CONFLICT", () => {
    const r = repo({ [A]: itemText({ id: A }) });
    const out = runCli([
      "set",
      A,
      "--status",
      "wip",
      "--expect",
      "deadbeef",
      "--json",
      "--repo",
      r.root,
    ]);
    assert.equal(out.status, 3);
    assert.equal(out.json.error.code, "DOCKET_CONFLICT");
  });

  test("claiming an item claimed by another worktree exits 3", () => {
    const r = repo({ [A]: itemText({ id: A }) });
    r.commit("init");
    const linked = path.join(r.dir, "linked tree");
    git(r.root, "worktree", "add", "-q", "-b", "other", linked);
    assert.equal(runCli(["claim", A, "--repo", r.root]).status, 0);
    const out = runCli(["claim", A, "--json", "--repo", linked]);
    assert.equal(out.status, 3);
    assert.equal(out.json.error.code, "DOCKET_CLAIMED");
  });

  test("unknown id exits 4", () => {
    const r = repo();
    assert.equal(runCli(["show", "dk-ffffffff", "--repo", r.root]).status, 4);
  });
});

describe("global flags", () => {
  test("--version prints package.json version", () => {
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const out = runCli(["--version"]);
    assert.equal(out.status, 0);
    assert.equal(out.stdout.trim(), version);
  });

  test("--help exits 0", () => {
    const out = runCli(["--help"]);
    assert.equal(out.status, 0);
    assert.match(out.stdout, /Usage: docket/);
  });

  test("--repo works from an unrelated cwd", () => {
    const r = repo({ [A]: itemText({ id: A }) });
    const out = runCli(["list", "--json", "--repo", r.root], { cwd: os.tmpdir() });
    assert.equal(out.status, 0);
    assert.equal(out.json.data.items.length, 1);
  });

  test("--repo that is not a git repo exits 2 with DOCKET_NOT_A_REPO", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docket plain "));
    try {
      const out = runCli(["list", "--json", "--repo", dir]);
      assert.equal(out.status, 2);
      assert.equal(out.json.error.code, "DOCKET_NOT_A_REPO");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("check --ref HEAD validates the committed tree", () => {
    const r = repo({ [A]: itemText({ id: B }) });
    r.commit("bad item");
    fs.rmSync(path.join(r.root, "docs", "items", `${A}.md`));
    assert.equal(runCli(["check", "--repo", r.root]).status, 0);
    assert.equal(runCli(["check", "--ref", "HEAD", "--repo", r.root]).status, 1);
  });
});
