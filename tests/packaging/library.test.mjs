// Library packaging: the packed tarball passes the build's library checks, and an `npm install` of it
// exposes exactly the documented subpath exports (README "Library API") to a consumer outside the
// checkout, with their revision and error semantics, while internal modules stay unreachable.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { readTarball } from "../../src/integration/gate/tarball.mjs";
import { tarballProblems } from "../../src/tooling/build.mjs";
import { ROOT, tempDir } from "../helpers/repository.mjs";
import { appData, docketRepo } from "../helpers/viewer.mjs";

const win = process.platform === "win32";
const npm = (args, cwd) => spawnSync("npm", args, { cwd, encoding: "utf8", shell: win });

/** The supported names per subpath: the contract README documents. Other names are internal. */
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
  "docket/repository/context": ["contextFor"],
  "docket/repository/canonical": ["canonicalPath", "sameKey"],
  "docket/repository/containment": ["assertSafeCheckout"],
  "docket/repository/registered-checkout": [
    "inspectCheckout",
    "unavailableReason",
    "createCheckoutOpener",
  ],
  "docket/registry/paths": ["registryPath"],
  "docket/registry/source": ["createRegistrySource", "findCheckout"],
  "docket/markdown": ["renderMarkdown"],
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
for (const spec of ["docket", "docket/src/core/errors.mjs", "docket/src/storage/lock.mjs", "docket/viewer"]) {
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
import { createCheckoutOpener } from "docket/repository/registered-checkout";
import { registryPath } from "docket/registry/paths";
import { createRegistrySource, findCheckout } from "docket/registry/source";
import { renderMarkdown } from "docket/markdown";

const [a, b] = process.argv.slice(2);
const source = createRegistrySource(registryPath(process.env));
const { registry, error, missing } = source.get();
const { repo, checkout } = findCheckout(registry, registry.repos[0].id);
const ctx = createCheckoutOpener()(repo, checkout, { fresh: true });
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
const rel = relationsView(ctx, a, { records: records(), claims });
const linked = linkItem(ctx, a, { relates: [b] }, { expect: rel.revision, expectRevisions: rel.revisions });
const after = readItem(ctx, a, { records: records(), claims }).data;
const done = setItem(ctx, b, { status: "done" }, { today, claims });
const html = renderMarkdown("# T\\n<script>x</script>\\n[l](../x.md)");
console.log(JSON.stringify({ error, missing, listed, stale, set, body, note, resolved, linked, after, done, html }));
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
  for (const doc of ["MOVE-IN.md", "AGENT-GUIDE.md"])
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

test("the tarball passes the build's checks: export map, guide, runtime dependencies", () => {
  assert.deepEqual(tarballProblems(entries), []);
  const names = new Set(entries.map((e) => e.name));
  assert.ok(names.has("package/docs/AGENT-GUIDE.md"));
  const pkg = JSON.parse(entries.find((e) => e.name === "package/package.json").data.toString());
  assert.equal(pkg.exports["."], undefined, "no catch-all root export");
  assert.deepEqual(
    Object.keys(pkg.exports)
      .map((k) => `docket${k.slice(1)}`)
      .sort(),
    Object.keys(CONTRACT).sort(),
    "every export is documented in the contract, and only those",
  );
  for (const d of ["marked", "sanitize-html"]) assert.ok(pkg.dependencies[d], d);
});

test("build checks catch a catch-all, a pattern, an unshipped target and a missing dependency", () => {
  const pkgEntry = (pkg) => [
    { name: "package/package.json", data: Buffer.from(JSON.stringify(pkg)) },
    ...entries.filter((e) => e.name !== "package/package.json"),
  ];
  const real = JSON.parse(entries.find((e) => e.name === "package/package.json").data.toString());
  const cases = [
    [{ ...real, exports: { ...real.exports, ".": "./src/cli/main.mjs" } }, /catch-all/],
    [{ ...real, exports: { ...real.exports, "./*": "./src/*.mjs" } }, /patterns/],
    [{ ...real, exports: { ...real.exports, "./x": "./src/tooling/build.mjs" } }, /shipped/],
    [{ ...real, exports: { ...real.exports, "./y": "./src/core/nope.mjs" } }, /not in the tarball/],
    [{ ...real, dependencies: { marked: "1" } }, /sanitize-html/],
    [{ ...real, exports: undefined }, /no subpath export map/],
  ];
  for (const [pkg, re] of cases) {
    const problems = tarballProblems(pkgEntry(pkg));
    assert.ok(
      problems.some((p) => re.test(p)),
      `${re}: ${problems.join("; ")}`,
    );
  }
});

test("an installed consumer reaches every documented name and nothing internal", (t) => {
  if (!needInstall(t)) return;
  for (const d of ["marked", "sanitize-html"])
    assert.ok(fs.existsSync(path.join(consumer, "node_modules", d, "package.json")), d);
  const { names, refused } = run(PROBE, [JSON.stringify(CONTRACT)]);
  for (const [spec, wanted] of Object.entries(CONTRACT)) {
    for (const name of wanted) assert.ok(names[spec].includes(name), `${spec} exports ${name}`);
  }
  for (const [spec, code] of Object.entries(refused)) {
    assert.equal(code, "ERR_PACKAGE_PATH_NOT_EXPORTED", spec);
  }
});

test("the public subpaths carry the revision and error semantics end to end", (t) => {
  if (!needInstall(t)) return;
  repo = docketRepo({}, { prefix: "docket-lib-pkg-repo-" });
  const cli = path.join(consumer, "node_modules", "docket", "src", "cli", "main.mjs");
  const dk = (...args) => {
    const r = spawnSync(process.execPath, [cli, ...args, "--repo", repo.root, "--json"], {
      env: { ...process.env, ...home.env },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return JSON.parse(r.stdout);
  };
  const add = (title) => dk("add", "--type", "task", "--priority", "P1", "--title", title).data.id;
  const a = add("Alpha");
  const b = add("Beta");
  repo.commit("items");
  const reg = spawnSync(process.execPath, [cli, "repo", "add", repo.root, "--json"], {
    env: { ...process.env, ...home.env },
    encoding: "utf8",
  });
  assert.equal(reg.status, 0, reg.stderr);

  const out = run(FLOW, [a, b], home.env);
  assert.equal(out.error, null);
  assert.equal(out.missing, false);
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
  assert.deepEqual(
    out.linked.written.map((w) => w.id),
    [a],
  );
  assert.equal(out.after.title, "Renamed");
  assert.equal(out.after.bodySource, "\nNew facts.\n");
  assert.deepEqual(out.after.relates, [b]);
  assert.equal(out.after.openNoteCount, 0);
  assert.equal(out.after.revision, out.linked.written[0].revision);
  assert.equal(out.done.data.completed, true);
  assert.deepEqual(out.done.warnings, []);
  assert.ok(!out.html.includes("<script"), out.html);
  assert.match(out.html, /class="unresolved"/);
});
