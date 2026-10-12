// Installed-CLI packaging: the packed tarball carries the CLI, guide and gate assets but no viewer and
// no removed dependency, and an install of it works from outside the checkout (version, guide, init,
// add, note, registry registration) and reports `serve` as removed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { readTarball } from "../../src/integration/gate/tarball.mjs";
import { ROOT, makeRepo, tempDir } from "../helpers/repository.mjs";

const win = process.platform === "win32";
const npm = (args, cwd) => spawnSync("npm", args, { cwd, encoding: "utf8", shell: win });
const REMOVED_DEPENDENCIES = ["marked", "sanitize-html", "playwright"];

function copyCheckout(dest) {
  fs.cpSync(path.join(ROOT, "src"), path.join(dest, "src"), { recursive: true });
  fs.mkdirSync(path.join(dest, "docs"));
  for (const doc of ["MOVE-IN.md", "AGENT-GUIDE.md"])
    fs.copyFileSync(path.join(ROOT, "docs", doc), path.join(dest, "docs", doc));
  for (const f of ["package.json", "README.md"])
    fs.copyFileSync(path.join(ROOT, f), path.join(dest, f));
}

/** makeRepo plus a committed docket.json, so it can be registered. */
function docketRepo(prefix) {
  const r = makeRepo({}, { prefix });
  fs.writeFileSync(path.join(r.root, "docket.json"), '{\n  "version": 1\n}\n');
  r.commit("init");
  return r;
}

test("the packed CLI installs and runs from outside the checkout", { timeout: 300000 }, (t) => {
  const work = tempDir("docket-cli-pkg-");
  const home = tempDir("docket cli home ");
  const repo = docketRepo("docket-cli-pkg-repo-");
  t.after(() => {
    work.cleanup();
    home.cleanup();
    repo.cleanup();
  });
  const checkout = path.join(work.dir, "checkout");
  fs.mkdirSync(checkout);
  copyCheckout(checkout);
  const packed = npm(["pack", "--pack-destination", work.dir, "--json"], checkout);
  assert.equal(packed.status, 0, packed.stderr);
  const tgz = path.join(work.dir, JSON.parse(packed.stdout)[0].filename.split(/[\\/]/).pop());

  const entries = readTarball(fs.readFileSync(tgz));
  const names = entries.map((e) => e.name);
  for (const f of ["src/cli/main.mjs", "src/cli/commands/guide.mjs", "docs/AGENT-GUIDE.md"])
    assert.ok(names.includes(`package/${f}`), f);
  assert.deepEqual(
    names.filter((n) => /^package\/src\/(viewer\/|cli\/commands\/viewer\.mjs$)/.test(n)),
    [],
  );
  const pkg = JSON.parse(entries.find((e) => e.name === "package/package.json").data.toString());
  const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  for (const d of REMOVED_DEPENDENCIES) assert.equal(declared[d], undefined, d);

  const inst = path.join(work.dir, "inst");
  const install = npm(
    ["install", "--prefix", inst, tgz, "--no-audit", "--no-fund", "--prefer-offline"],
    work.dir,
  );
  if (install.status !== 0) {
    if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network|fetch failed/i.test(install.stderr)) {
      t.skip(`npm install needs the network: ${install.stderr.slice(0, 200)}`);
      return;
    }
    assert.fail(install.stderr);
  }
  for (const d of REMOVED_DEPENDENCIES)
    assert.ok(!fs.existsSync(path.join(inst, "node_modules", d)), `${d} installed`);

  const cwd = path.join(work.dir, "run");
  fs.mkdirSync(cwd);
  const cli = path.join(inst, "node_modules", "docket", "src", "cli", "main.mjs");
  const env = { ...process.env, DOCKET_HOME: home.dir };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });

  const version = run("--version");
  assert.equal(version.stdout.trim(), pkg.version, version.stderr);
  const guide = JSON.parse(run("guide", "--json").stdout);
  assert.equal(guide.ok, true);
  assert.match(guide.data.text, /^# Docket agent guide/);
  assert.ok(guide.data.path.includes("node_modules"), guide.data.path);

  const serve = run("serve", "--json");
  assert.equal(serve.status, 2);
  assert.equal(serve.stderr, "");
  assert.deepEqual(JSON.parse(serve.stdout).error, {
    code: "DOCKET_USAGE",
    message: "docket serve was removed in 0.7.0 — use Command Deck for the UI.",
  });

  const fresh = tempDir("docket-cli-pkg-init-");
  t.after(() => fresh.cleanup());
  spawnSync("git", ["init", "-q", fresh.dir]);
  const init = JSON.parse(run("init", "--json", "--repo", fresh.dir).stdout);
  assert.equal(init.ok, true, JSON.stringify(init));
  for (const f of ["CLAUDE.md", "AGENTS.md"]) {
    const text = fs.readFileSync(path.join(fresh.dir, f), "utf8");
    assert.match(text, /<!-- docket:agent-snippet begin v2 -->/);
    assert.match(text, /docket guide/);
  }

  const added = JSON.parse(
    run(
      "add",
      "--repo",
      repo.root,
      "--type",
      "task",
      "--priority",
      "P1",
      "--title",
      "Pkg",
      "--json",
    ).stdout,
  );
  assert.equal(added.ok, true, JSON.stringify(added));
  const noted = run("note", added.data.id, "<b>question</b>", "--repo", repo.root);
  assert.equal(noted.status, 0, noted.stderr);
  const shown = JSON.parse(run("show", added.data.id, "--repo", repo.root, "--json").stdout);
  assert.equal(shown.data.notes[0].text, "<b>question</b>");

  const registered = run("repo", "add", repo.root);
  assert.equal(registered.status, 0, registered.stderr);
  const listed = JSON.parse(run("repo", "list", "--json").stdout);
  assert.equal(listed.data.repos.length, 1);
  assert.ok(fs.existsSync(path.join(home.dir, "registry.json")));
});
