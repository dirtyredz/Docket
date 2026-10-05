// Viewer packaging: the packed tarball carries every UI asset, and an install of it (with its
// dependencies resolved by npm) serves the viewer end to end from outside the checkout.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { readTarball } from "../../src/integration/gate/tarball.mjs";
import { ASSETS } from "../../src/viewer/server/static.mjs";
import { ROOT, tempDir } from "../helpers/repository.mjs";
import { appData, docketRepo } from "../helpers/viewer.mjs";

const win = process.platform === "win32";
const npm = (args, cwd) => spawnSync("npm", args, { cwd, encoding: "utf8", shell: win });

function copyCheckout(dest) {
  fs.cpSync(path.join(ROOT, "src"), path.join(dest, "src"), { recursive: true });
  fs.mkdirSync(path.join(dest, "docs"));
  fs.copyFileSync(path.join(ROOT, "docs", "MOVE-IN.md"), path.join(dest, "docs", "MOVE-IN.md"));
  for (const f of ["package.json", "README.md"])
    fs.copyFileSync(path.join(ROOT, f), path.join(dest, f));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test(
  "the packed viewer installs and serves from outside the checkout",
  { timeout: 300000 },
  async (t) => {
    const work = tempDir("docket-viewer-pkg-");
    const home = appData();
    const repo = docketRepo({}, { prefix: "docket-viewer-pkg-repo-" });
    let child;
    t.after(() => {
      child?.kill();
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
    const names = new Set(entries.map((e) => e.name));
    for (const asset of ASSETS) assert.ok(names.has(`package/src/viewer/ui/${asset}`), asset);
    for (const f of ["src/viewer/server/main.mjs", "src/viewer/documents/render.mjs"])
      assert.ok(names.has(`package/${f}`), f);
    const pkg = JSON.parse(entries.find((e) => e.name === "package/package.json").data.toString());
    assert.ok(pkg.dependencies.marked);
    assert.ok(pkg.dependencies["sanitize-html"]);

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

    const cwd = path.join(work.dir, "run");
    fs.mkdirSync(cwd);
    const cli = path.join(inst, "node_modules", "docket", "src", "cli", "main.mjs");
    const env = { ...process.env, ...home.env };
    const run = (...args) =>
      spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });

    const version = run("--version");
    assert.equal(version.stdout.trim(), pkg.version, version.stderr);

    fs.mkdirSync(path.join(repo.root, "docs"), { recursive: true });
    fs.writeFileSync(
      path.join(repo.root, "docs", "ARCHITECTURE.md"),
      "# Arch\n<script>x</script>\n",
    );
    repo.commit("docs");
    const add = run("repo", "add", repo.root);
    assert.equal(add.status, 0, add.stderr);

    child = spawn(process.execPath, [cli, "serve", "--json"], { cwd, env });
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c));
    const line = await new Promise((resolve, reject) => {
      let buf = "";
      child.stdout.on("data", (c) => {
        buf += c;
        const i = buf.indexOf("\n");
        if (i >= 0) resolve(buf.slice(0, i));
      });
      child.on("exit", (code) => reject(new Error(`serve exited ${code}: ${stderr}`)));
      setTimeout(() => reject(new Error(`serve timed out: ${stderr}`)), 30000);
    });
    const started = JSON.parse(line);
    assert.equal(started.ok, true);
    assert.equal(started.command, "serve");
    const { url } = started.data;
    assert.ok(url.startsWith("http://127.0.0.1:"), url);

    const shell = await fetch(url);
    assert.match(await shell.text(), /<title>Docket<\/title>/);
    assert.equal((await fetch(`${url}ui/app.mjs`)).status, 200);

    const api = async (p) => (await fetch(new URL(p, url))).json();
    let overview;
    for (const end = Date.now() + 20000; ; await sleep(50)) {
      overview = await api("/api/repos");
      if (overview.coverage.loading === 0) break;
      assert.ok(Date.now() < end, "catalog did not settle");
    }
    assert.equal(overview.repos.length, 1);
    assert.equal(overview.coverage.ready, 1, JSON.stringify(overview));
    const r = overview.repos[0];
    const doc = await api(`/api/repos/${r.id}/checkouts/${r.preferred}/documents/ARCHITECTURE`);
    assert.ok(doc.html.includes("<h1>Arch</h1>"), doc.html);
    assert.ok(!doc.html.includes("<script"), doc.html);
  },
);
