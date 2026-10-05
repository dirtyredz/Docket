// Last-good gate packaging: promotion from a real `npm pack` tarball, isolation from the working tree,
// failed promotions keep the previous version, and both command aliases install.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import { installRepo } from "../../src/integration/gate/install.mjs";
import { readActive } from "../../src/integration/gate/paths.mjs";
import { promoteTarball } from "../../src/integration/gate/promote.mjs";
import { TEMPLATE, addRemote, push, templateAvailable } from "../helpers/gate.mjs";
import { ROOT, itemText, makeRepo, tempDir } from "../helpers/repository.mjs";

const win = process.platform === "win32";
const npm = (args, cwd) => spawnSync("npm", args, { cwd, encoding: "utf8", shell: win });

/** Copy the publishable parts of the checkout, so a test can break "its" working tree freely. */
function copyCheckout(dest) {
  fs.cpSync(path.join(ROOT, "src"), path.join(dest, "src"), { recursive: true });
  for (const f of ["package.json", "README.md"])
    fs.copyFileSync(path.join(ROOT, f), path.join(dest, f));
}

function pack(checkout, outDir) {
  const r = npm(["pack", "--pack-destination", outDir, "--json"], checkout);
  assert.equal(r.status, 0, r.stderr);
  return path.join(outDir, JSON.parse(r.stdout)[0].filename.split(/[\\/]/).pop());
}

let work;
let checkout;
let gateRoot;
let tarball;
before(() => {
  work = tempDir("docket-pkg-");
  checkout = path.join(work.dir, "checkout");
  gateRoot = path.join(work.dir, "gate");
  fs.mkdirSync(checkout);
  copyCheckout(checkout);
  tarball = pack(checkout, work.dir);
});
after(() => work?.cleanup());

describe("last-good gate", () => {
  test("promotion installs an immutable version, the launcher and active.json", () => {
    const active = promoteTarball(tarball, { gateRoot });
    assert.match(active.version, /^\d+\.\d+\.\d+-[0-9a-f]{8}$/);
    assert.equal(active.entry, "src/integration/gate/pre-push.mjs");
    assert.ok(fs.existsSync(path.join(gateRoot, active.dir, active.entry)));
    assert.ok(fs.existsSync(path.join(gateRoot, "launcher.mjs")));
    assert.deepEqual(readActive(gateRoot).version, active.version);
  });

  test(
    "a deliberately broken working tree cannot break the installed gate",
    { skip: !templateAvailable() && "no template" },
    () => {
      if (!readActive(gateRoot)) promoteTarball(tarball, { gateRoot });
      const r = makeRepo(
        { "dk-0000c001": itemText({ id: "dk-0000c001" }) },
        { prefix: "docket-pkg-repo-" },
      );
      try {
        r.commit("valid");
        addRemote(r.root, r.dir);
        installRepo(r.root, { gateRoot, templatePath: TEMPLATE });
        // Break the source the tarball was built from: parser and CLI entry both throw on import.
        for (const f of ["src/core/format/parse.mjs", "src/cli/main.mjs"]) {
          fs.writeFileSync(path.join(checkout, f), 'throw new Error("broken working tree");\n');
        }
        let out = push(r.root, ["origin", "main"]);
        assert.equal(out.status, 0, out.stderr);
        assert.doesNotMatch(out.stderr, /broken working tree/);
        r.write("dk-0000c002", "not an item\n");
        r.commit("invalid");
        out = push(r.root, ["origin", "main"]);
        assert.notEqual(out.status, 0, "the installed gate still rejects invalid items");
        assert.match(out.stderr, /dk-0000c002\.md/);
      } finally {
        copyCheckout(checkout);
        r.cleanup();
      }
    },
  );

  test("a failed promotion keeps the previous version active and leaves no staging copy", () => {
    if (!readActive(gateRoot)) promoteTarball(tarball, { gateRoot });
    const previous = readActive(gateRoot);
    const brokenDir = path.join(work.dir, "broken-checkout");
    fs.mkdirSync(brokenDir);
    copyCheckout(brokenDir);
    const pkg = JSON.parse(fs.readFileSync(path.join(brokenDir, "package.json"), "utf8"));
    pkg.version = "9.9.9";
    fs.writeFileSync(path.join(brokenDir, "package.json"), JSON.stringify(pkg, null, 2));
    fs.writeFileSync(
      path.join(brokenDir, "src/core/validation/relations.mjs"),
      "export const nope = 1;\n",
    );
    const outDir = path.join(work.dir, "broken-out");
    fs.mkdirSync(outDir);
    const bad = pack(brokenDir, outDir);
    assert.throws(() => promoteTarball(bad, { gateRoot }));
    assert.deepEqual(readActive(gateRoot), previous);
    const versions = fs.readdirSync(path.join(gateRoot, "versions"));
    assert.ok(!versions.some((v) => v.startsWith(".staging")), versions.join());
    assert.ok(!versions.some((v) => v.startsWith("9.9.9")), versions.join());
  });

  test("re-promoting records the previous version for rollback", () => {
    const first = promoteTarball(tarball, { gateRoot });
    const other = path.join(work.dir, "other-checkout");
    fs.mkdirSync(other);
    copyCheckout(other);
    fs.appendFileSync(path.join(other, "README.md"), "\nchanged\n");
    const outDir = path.join(work.dir, "other-out");
    fs.mkdirSync(outDir);
    const second = promoteTarball(pack(other, outDir), { gateRoot });
    assert.notEqual(second.version, first.version);
    assert.equal(second.previous.version, first.version);
    assert.ok(fs.existsSync(path.join(gateRoot, first.dir)), "previous version retained");
  });

  test("both command aliases install from the tarball", () => {
    const prefix = path.join(work.dir, "prefix");
    const r = npm(["install", "--global", "--prefix", prefix, tarball], work.dir);
    assert.equal(r.status, 0, r.stderr);
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
    for (const name of ["docket", "dk"]) {
      const bin = win ? path.join(prefix, `${name}.cmd`) : path.join(prefix, "bin", name);
      assert.ok(fs.existsSync(bin), bin);
      const out = spawnSync(bin, ["--version"], { encoding: "utf8", shell: win, cwd: work.dir });
      assert.equal(out.stdout.trim(), version, out.stderr);
    }
  });
});

describe("last-good gate: promoted copy without dependencies", () => {
  test("CLI commands run, and the viewer's dependencies load only lazily", () => {
    const active = promoteTarball(tarball, { gateRoot });
    const src = path.join(gateRoot, readActive(gateRoot).dir ?? active.dir, "src");
    assert.ok(!fs.existsSync(path.join(src, "..", "node_modules")), "no node_modules in the copy");
    const cli = path.join(src, "cli", "main.mjs");
    const node = (...args) => spawnSync(process.execPath, args, { encoding: "utf8" });
    for (const args of [["--version"], ["repo", "--help"], ["serve", "--help"]]) {
      const r = node(cli, ...args);
      assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`);
    }
    const r = makeRepo(
      { "dk-0000c003": itemText({ id: "dk-0000c003" }) },
      { prefix: "docket-pkg-chk-" },
    );
    try {
      r.commit("valid");
      const check = node(cli, "check", "--repo", r.root);
      assert.equal(check.status, 0, check.stdout + check.stderr);
    } finally {
      r.cleanup();
    }
    const viewer = pathToFileURL(path.join(src, "viewer", "server", "main.mjs")).href;
    const imp = node("-e", `import(${JSON.stringify(viewer)})`);
    assert.notEqual(imp.status, 0, "the viewer needs marked and sanitize-html");
    assert.match(imp.stderr, /marked|sanitize-html|ERR_MODULE_NOT_FOUND/);
  });
});
