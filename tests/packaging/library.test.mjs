// Library packaging: the packed tarball passes the build's checks (export map, contract doc, no viewer, no
// rendering dependency), and an `npm install` of it exposes exactly the documented subpath exports
// (docs/LIBRARY.md) to a consumer outside the checkout, with their scope, revision and error semantics,
// while internal modules stay unreachable and nothing but Docket itself is installed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { readTarball } from "../../src/integration/gate/tarball.mjs";
import { REMOVED_DEPENDENCIES, tarballProblems } from "../../src/tooling/build.mjs";
import { ROOT, tempDir } from "../helpers/repository.mjs";
import { appData, docketRepo } from "../helpers/registry.mjs";

const win = process.platform === "win32";
const npm = (args, cwd) => spawnSync("npm", args, { cwd, encoding: "utf8", shell: win });

/**
 * The supported names per subpath: the contract docs/LIBRARY.md documents. Other names are internal and
 * unreachable: each subpath resolves to a facade in src/library/ that re-exports only these.
 */
const CONTRACT = {
  "docket/package.json": [],
  "docket/errors": ["CODES", "KIND_OF_CODE"],
  "docket/schema": ["ENUMS", "ID_RE", "RELATION_KEYS", "CLOSED_STATUSES"],
  "docket/date": ["localDate"],
  "docket/items/index": ["loadIndex"],
  "docket/items/query": ["listItems", "compareItems", "countBy", "COUNT_FIELDS"],
  "docket/items/detail": ["readItem"],
  "docket/items/relations": ["relationsView"],
  "docket/items/set": ["setItem"],
  "docket/items/body": ["replaceBody"],
  "docket/items/notes": ["addNote", "resolveNote"],
  "docket/items/link": ["linkItem"],
  "docket/claims": ["readClaims", "releaseItem"],
  "docket/repository/context": ["contextFor", "contextAtRoot"],
  "docket/repository/canonical": ["canonicalPath", "pathKey", "sameKey"],
  "docket/repository/containment": ["assertSafeCheckout"],
  "docket/repository/registered-checkout": [
    "inspectCheckout",
    "unavailableReason",
    "openCheckoutAt",
    "createCheckoutOpener",
  ],
  "docket/registry/paths": ["registryPath"],
  "docket/registry/source": ["createRegistrySource", "findCheckout"],
};

// Run inside the consumer directory, so bare `docket/...` specifiers resolve from its node_modules.
const PROBE = `
const contract = JSON.parse(process.argv[2]);
const out = { names: {}, refused: {} };
for (const spec of Object.keys(contract)) {
  const mod = spec.endsWith(".json")
    ? await import(spec, { with: { type: "json" } })
    : await import(spec);
  out.names[spec] = Object.keys(mod);
}
for (const spec of ["docket", "docket/src/core/errors.mjs", "docket/src/storage/lock.mjs",
  "docket/viewer", "docket/markdown", "docket/items/transaction"]) {
  try {
    await import(spec);
    out.refused[spec] = null;
  } catch (err) {
    out.refused[spec] = err.code;
  }
}
console.log(JSON.stringify(out));
`;

// One end-to-end pass over a registered checkout through the public subpaths only.
const FLOW = `
import { CODES } from "docket/errors";
import { localDate } from "docket/date";
import { loadIndex } from "docket/items/index";
import { listItems } from "docket/items/query";
import { readItem } from "docket/items/detail";
import { relationsView } from "docket/items/relations";
import { setItem } from "docket/items/set";
import { replaceBody } from "docket/items/body";
import { addNote, resolveNote } from "docket/items/notes";
import { linkItem } from "docket/items/link";
import * as claims from "docket/claims";
import { createCheckoutOpener, openCheckoutAt } from "docket/repository/registered-checkout";
import { registryPath } from "docket/registry/paths";
import { createRegistrySource, findCheckout } from "docket/registry/source";

const [a, b, root] = process.argv.slice(2);
const source = createRegistrySource(registryPath(process.env));
const { registry, error, missing } = source.get({ refresh: true });
const { repo, checkout } = findCheckout(registry, registry.repos[0].id);
const ctx = createCheckoutOpener()(repo, checkout, { fresh: true });
const direct = openCheckoutAt(root);
let ancestor = null;
try {
  openCheckoutAt(root + "/docs");
} catch (err) {
  ancestor = err.code;
}
const today = localDate();
const records = () => loadIndex(ctx).records;
const listed = listItems(records()).items.map((i) => i.id);
const detail = readItem(ctx, a, { records: records(), claims }).data;
let stale = null;
try {
  setItem(ctx, a, { status: "wip" }, { today, expect: "0000000000000000", claims });
} catch (err) {
  stale = { code: err.code, isConflict: err.code === CODES.CONFLICT, details: err.details };
}
const set = setItem(ctx, a, { title: "Renamed" }, { today, expect: detail.revision, claims }).data;
const body = replaceBody(ctx, a, "\\nNew facts.\\n", { expect: set.revision });
const note = addNote(ctx, a, { text: "<b>q</b>", author: "owner" }, { expect: body.revision });
const resolved = resolveNote(ctx, a, note.ref, { expect: note.revision });
const shown = readItem(ctx, a, { records: records(), claims }).data;
const rel = relationsView(ctx, a, { records: records(), claims, detail: shown });
const linked = linkItem(ctx, a, { relates: [b] }, { expectRevisions: rel.revisions });
let missingHolder = null;
try {
  linkItem(ctx, a, { relates: [b], remove: true }, { expectRevisions: { [a]: rel.revision } });
} catch (err) {
  missingHolder = err.code;
}
const after = readItem(ctx, a, { records: records(), claims }).data;
const done = setItem(ctx, b, { status: "done" }, { today, claims });
console.log(JSON.stringify({ error, missing, sameRoot: direct.root === ctx.root, ancestor,
  listed, stale, set, body, note, resolved, rel, linked, missingHolder, after, done }));
`;

let work;
let home;
let repo;
let consumer;
let entries;
let installError = null;
before(() => {
  work = tempDir("docket-lib-pkg-");
  home = appData();
  const checkout = path.join(work.dir, "checkout");
  fs.cpSync(path.join(ROOT, "src"), path.join(checkout, "src"), { recursive: true });
  fs.mkdirSync(path.join(checkout, "docs"));
  for (const doc of ["MOVE-IN.md", "AGENT-GUIDE.md", "LIBRARY.md"])
    fs.copyFileSync(path.join(ROOT, "docs", doc), path.join(checkout, "docs", doc));
  for (const f of ["package.json", "README.md"])
    fs.copyFileSync(path.join(ROOT, f), path.join(checkout, f));
  const packed = npm(["pack", "--pack-destination", work.dir, "--json"], checkout);
  assert.equal(packed.status, 0, packed.stderr);
  const tgz = path.join(work.dir, JSON.parse(packed.stdout)[0].filename.split(/[\\/]/).pop());
  entries = readTarball(fs.readFileSync(tgz));

  consumer = path.join(work.dir, "consumer");
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, "package.json"), '{"name":"consumer","private":true}\n');
  const install = npm(
    ["install", tgz, "--no-audit", "--no-fund", "--prefer-offline", "--ignore-scripts"],
    consumer,
  );
  if (install.status !== 0) installError = install.stderr;
});
after(() => {
  work?.cleanup();
  home?.cleanup();
  repo?.cleanup();
});

function needInstall(t) {
  if (installError === null) return true;
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network|fetch failed/i.test(installError)) {
    t.skip(`npm install needs the network: ${installError.slice(0, 200)}`);
    return false;
  }
  assert.fail(installError);
}

const run = (script, args = [], env = {}) => {
  const file = path.join(consumer, `probe-${Math.random().toString(16).slice(2)}.mjs`);
  fs.writeFileSync(file, script);
  const r = spawnSync(process.execPath, [file, ...args], {
    cwd: consumer,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("the tarball passes the build's checks: export map, contract doc, no viewer", () => {
  assert.deepEqual(tarballProblems(entries), []);
  const names = entries.map((e) => e.name);
  for (const doc of ["AGENT-GUIDE.md", "LIBRARY.md", "MOVE-IN.md"])
    assert.ok(names.includes(`package/docs/${doc}`), doc);
  assert.deepEqual(
    names.filter((n) => /^package\/src\/(viewer\/|cli\/commands\/viewer\.mjs$)/.test(n)),
    [],
  );
  const pkg = JSON.parse(entries.find((e) => e.name === "package/package.json").data.toString());
  assert.equal(pkg.exports["."], undefined, "no catch-all root export");
  assert.deepEqual(
    Object.keys(pkg.exports)
      .map((k) => `docket${k.slice(1)}`)
      .sort(),
    Object.keys(CONTRACT).sort(),
    "every export is documented in the contract, and only those",
  );
  const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  for (const d of REMOVED_DEPENDENCIES) assert.equal(declared[d], undefined, d);
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], "the library has no runtime deps");
});

test("the documented contract names every export", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs", "LIBRARY.md"), "utf8");
  for (const [spec, names] of Object.entries(CONTRACT)) {
    assert.ok(doc.includes(`\`${spec}\``), `LIBRARY.md documents ${spec}`);
    for (const name of names) assert.ok(doc.includes(name), `LIBRARY.md documents ${name}`);
  }
});

test("build checks catch a catch-all, a pattern, a bad target and a revived dependency", () => {
  const pkgEntry = (pkg) => [
    { name: "package/package.json", data: Buffer.from(JSON.stringify(pkg)) },
    ...entries.filter((e) => e.name !== "package/package.json"),
  ];
  const real = JSON.parse(entries.find((e) => e.name === "package/package.json").data.toString());
  const cases = [
    [{ ...real, exports: { ...real.exports, ".": "./src/cli/main.mjs" } }, /catch-all/],
    [{ ...real, exports: { ...real.exports, "./*": "./src/*.mjs" } }, /patterns/],
    [{ ...real, exports: { ...real.exports, "./x": "./src/tooling/build.mjs" } }, /shipped/],
    [{ ...real, exports: { ...real.exports, "./v": "./src/viewer/server/main.mjs" } }, /shipped/],
    [{ ...real, exports: { ...real.exports, "./y": "./src/core/nope.mjs" } }, /not in the tarball/],
    [{ ...real, dependencies: { marked: "1" } }, /removed dependency declared again: marked/],
    [{ ...real, devDependencies: { playwright: "1" } }, /removed dependency.*playwright/],
    [{ ...real, exports: undefined }, /no subpath export map/],
  ];
  for (const [pkg, re] of cases) {
    const problems = tarballProblems(pkgEntry(pkg));
    assert.ok(
      problems.some((p) => re.test(p)),
      `${re}: ${problems.join("; ")}`,
    );
  }
  const leaked = [...entries, { name: "package/src/viewer/ui/app.mjs", data: Buffer.from("") }];
  assert.ok(tarballProblems(leaked).some((p) => /must not ship/.test(p)));
});

test("an installed consumer reaches every documented name and nothing internal", (t) => {
  if (!needInstall(t)) return;
  const installed = fs.readdirSync(path.join(consumer, "node_modules")).filter((n) => n[0] !== ".");
  assert.deepEqual(installed, ["docket"], "no sibling or rendering dependency is installed");
  const { names, refused } = run(PROBE, [JSON.stringify(CONTRACT)]);
  for (const [spec, wanted] of Object.entries(CONTRACT)) {
    // The exact namespace: no extra (unsupported) and no missing name. A JSON import is only `default`.
    const expected = spec.endsWith(".json") ? ["default"] : [...wanted].sort();
    assert.deepEqual([...names[spec]].sort(), expected, `${spec} exports exactly the contract`);
  }
  for (const [spec, code] of Object.entries(refused)) {
    assert.equal(code, "ERR_PACKAGE_PATH_NOT_EXPORTED", spec);
  }
});

test("the public subpaths carry the scope, revision and error semantics end to end", (t) => {
  if (!needInstall(t)) return;
  repo = docketRepo({}, { prefix: "docket-lib-pkg-repo-" });
  const cli = path.join(consumer, "node_modules", "docket", "src", "cli", "main.mjs");
  const dk = (...args) => {
    const r = spawnSync(process.execPath, [cli, ...args, "--json"], {
      env: { ...process.env, ...home.env },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return JSON.parse(r.stdout);
  };
  const add = (title) =>
    dk("add", "--type", "task", "--priority", "P1", "--title", title, "--repo", repo.root).data.id;
  const a = add("Alpha");
  const b = add("Beta");
  // b relates a, stored on b: removing it from a's side rewrites b (a reverse-stored holder).
  dk("link", b, "--relates", a, "--repo", repo.root);
  repo.commit("items");
  dk("repo", "add", repo.root);

  const out = run(FLOW, [a, b, repo.root], home.env);
  assert.equal(out.error, null);
  assert.equal(out.missing, false);
  assert.equal(out.sameRoot, true, "exact-root and registered opening agree");
  assert.equal(out.ancestor, "DOCKET_NOT_A_REPO");
  assert.deepEqual([...out.listed].sort(), [a, b].sort());
  assert.equal(out.stale.code, "DOCKET_CONFLICT");
  assert.equal(out.stale.isConflict, true);
  assert.equal(out.stale.details.expected, "0000000000000000");
  assert.deepEqual(out.set.changed, ["title"]);
  assert.equal(out.set.noop, false);
  assert.equal(out.body.noop, false);
  assert.notEqual(out.body.revision, out.set.revision);
  assert.equal(out.note.state, "open");
  assert.equal(out.note.author, "owner");
  assert.equal(out.resolved.state, "resolved");
  assert.deepEqual(out.rel.reverseStored, [b]);
  assert.deepEqual(Object.keys(out.rel.revisions).sort(), [a, b].sort());
  assert.equal(out.rel.revisions[a], out.resolved.revision, "the map holds the displayed bytes");
  assert.deepEqual(out.linked.written, [], "a relates already stored on b: a no-op");
  assert.equal(out.missingHolder, "DOCKET_USAGE");
  assert.equal(out.after.title, "Renamed");
  assert.equal(out.after.bodySource, "\nNew facts.\n");
  assert.equal(out.after.openNoteCount, 0);
  assert.equal(out.done.data.completed, true);
  assert.deepEqual(out.done.warnings, []);
});
