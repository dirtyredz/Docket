// Command-level contract of `docket repo`: usage errors, envelopes, human text, registry location.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { makeRepo, runCli, tempDir } from "../../helpers/repository.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));

function setup() {
  const r = makeRepo();
  const home = tempDir("docket home ");
  cleanups.push(r.cleanup, home.cleanup);
  fs.writeFileSync(path.join(r.root, "docket.json"), '{"version": 1}\n');
  r.commit("init");
  const env = { DOCKET_HOME: home.dir };
  return { ...r, env, run: (...args) => runCli(["repo", ...args, "--json"], { env }) };
}

describe("repo usage", () => {
  test("no subcommand and an unknown subcommand exit 2", () => {
    const home = tempDir("docket home ");
    cleanups.push(home.cleanup);
    const env = { DOCKET_HOME: home.dir };
    const none = runCli(["repo", "--json"], { env });
    assert.equal(none.status, 2);
    assert.equal(none.json.error.code, "DOCKET_USAGE");
    const bad = runCli(["repo", "frobnicate", "--json"], { env });
    assert.equal(bad.status, 2);
    assert.match(bad.json.error.message, /frobnicate/);
    assert.equal(runCli(["repo"], { env }).status, 2);
  });

  test("add without a path exits 2", () => {
    assert.equal(setup().run("add").status, 2);
  });

  test("without DOCKET_HOME and LOCALAPPDATA the registry is refused, mentioning LOCALAPPDATA", () => {
    const env = { DOCKET_HOME: "", LOCALAPPDATA: "" };
    const out = runCli(["repo", "list", "--json"], { env });
    assert.equal(out.status, 2);
    assert.equal(out.json.error.code, "DOCKET_USAGE");
    assert.match(out.json.error.message, /LOCALAPPDATA/);
    const human = runCli(["repo", "list"], { env });
    assert.equal(human.status, 2);
    assert.match(human.stderr + human.stdout, /LOCALAPPDATA/);
  });

  test("a relative DOCKET_HOME is refused", () => {
    const out = runCli(["repo", "list", "--json"], { env: { DOCKET_HOME: "relative/dir" } });
    assert.equal(out.status, 2);
  });
});

describe("repo output", () => {
  test("list with nothing registered says so, in text and as an empty array", () => {
    const r = setup();
    const human = runCli(["repo", "list"], { env: r.env });
    assert.equal(human.status, 0);
    assert.match(human.stdout, /no repos registered/);
    const out = r.run("list");
    assert.equal(out.json.ok, true);
    assert.equal(out.json.command, "repo");
    assert.deepEqual(out.json.data.repos, []);
    assert.equal(out.json.data.registry, path.join(r.env.DOCKET_HOME, "registry.json"));
  });

  test("add, list, remove and scan produce {ok, command, data, warnings} envelopes", () => {
    const r = setup();
    const add = r.run("add", r.root);
    assert.equal(add.json.ok, true);
    assert.equal(add.json.command, "repo");
    assert.equal(add.json.data.change, "created");
    assert.ok(Array.isArray(add.json.warnings));
    assert.match(add.json.data.repo.id, /^r-[0-9a-f]{8}$/);
    assert.match(add.json.data.checkout.id, /^c-[0-9a-f]{8}$/);

    const list = r.run("list");
    assert.equal(list.json.data.repos.length, 1);
    assert.equal(list.json.data.repos[0].checkouts[0].available, true);
    assert.equal(list.json.data.repos[0].checkouts[0].preferred, true);

    const scan = r.run("scan", r.dir);
    assert.equal(scan.json.ok, true);
    assert.equal(scan.json.command, "repo");
    assert.equal(scan.json.data.repos[0].change, "unchanged");

    const rm = r.run("remove", add.json.data.repo.alias);
    assert.equal(rm.json.ok, true);
    assert.equal(rm.json.data.removed, "repo");
    assert.equal(r.run("list").json.data.repos.length, 0);
  });

  test("errors are {ok:false, error:{code,message}}", () => {
    const out = setup().run("remove", "ghost");
    assert.equal(out.status, 4);
    assert.equal(out.json.ok, false);
    assert.equal(out.json.error.code, "DOCKET_NOT_FOUND");
    assert.equal(typeof out.json.error.message, "string");
  });

  test("a corrupt registry is DOCKET_INVALID (exit 1) and left untouched", () => {
    const r = setup();
    const file = path.join(r.env.DOCKET_HOME, "registry.json");
    fs.writeFileSync(file, "{ nope");
    for (const args of [["list"], ["add", r.root], ["remove", "x"]]) {
      const out = r.run(...args);
      assert.equal(out.status, 1, args.join(" "));
      assert.equal(out.json.error.code, "DOCKET_INVALID");
    }
    assert.equal(fs.readFileSync(file, "utf8"), "{ nope");
  });

  test("human add output names the alias and change", () => {
    const r = setup();
    const out = runCli(["repo", "add", r.root, "--alias", "mine"], { env: r.env });
    assert.match(out.stdout, /mine: created/);
  });
});
