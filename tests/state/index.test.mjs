import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { INDEX_VERSION, indexPath, loadIndex } from "../../src/state/index/build.mjs";
import { resolveRepo } from "../../src/repository/context.mjs";
import { git, itemText, makeRepo, runCli } from "../helpers/repository.mjs";

const IDS = ["dk-00000001", "dk-00000002", "dk-00000003"];

function repoWith(t, ids = IDS) {
  const repo = makeRepo(
    Object.fromEntries(ids.map((id, i) => [id, itemText({ id }, { title: `Item ${i + 1}` })])),
  );
  t.after(repo.cleanup);
  return { ...repo, ctx: resolveRepo(repo.root) };
}

const readIndex = (ctx) => JSON.parse(fs.readFileSync(indexPath(ctx), "utf8"));
const writeIndex = (ctx, data) => fs.writeFileSync(indexPath(ctx), JSON.stringify(data));
const byId = (records) => Object.fromEntries(records.map((r) => [r.id, r]));

test("first load writes the index, the second parses nothing", (t) => {
  const { ctx, root } = repoWith(t);
  const first = loadIndex(ctx);
  assert.equal(first.stats.parsed, IDS.length);
  assert.equal(first.stats.total, IDS.length);
  assert.equal(first.stats.cache, "missing");
  assert.ok(fs.existsSync(path.join(root, ".docket", "index.json")));
  assert.equal(readIndex(ctx).version, INDEX_VERSION);
  const second = loadIndex(ctx);
  assert.equal(second.stats.parsed, 0);
  assert.equal(second.stats.cache, "ok");
  assert.deepEqual(second.records.map((r) => r.id).sort(), IDS);
});

test("files older than the cache are reused by stat alone", (t) => {
  const { ctx } = repoWith(t);
  loadIndex(ctx);
  const data = readIndex(ctx);
  data.builtAt = Date.now() + 10 * 60 * 1000;
  writeIndex(ctx, data);
  const { stats } = loadIndex(ctx);
  assert.equal(stats.reused, stats.total);
  assert.equal(stats.parsed, 0);
});

test("changed content is detected and new fields are visible", (t) => {
  const { ctx, write } = repoWith(t);
  loadIndex(ctx);
  const data = readIndex(ctx);
  data.builtAt = Date.now() + 10 * 60 * 1000;
  writeIndex(ctx, data);
  write("dk-00000002", itemText({ id: "dk-00000002", status: "done" }, { title: "Item two!" }));
  const { records, stats } = loadIndex(ctx);
  assert.equal(stats.parsed, 1);
  assert.equal(stats.reused, 2);
  const rec = byId(records)["dk-00000002"];
  assert.equal(rec.title, "Item two!");
  assert.equal(rec.fields.status, "done");
});

test("a deleted file is counted as removed and dropped", (t) => {
  const { ctx, root } = repoWith(t);
  loadIndex(ctx);
  fs.rmSync(path.join(root, "docs", "items", "dk-00000003.md"));
  const { records, stats } = loadIndex(ctx);
  assert.equal(stats.removed, 1);
  assert.equal(stats.total, 2);
  assert.deepEqual(records.map((r) => r.id).sort(), IDS.slice(0, 2));
  assert.deepEqual(
    Object.keys(readIndex(ctx).files).sort(),
    IDS.slice(0, 2).map((i) => `${i}.md`),
  );
});

test("a garbage index.json is reported corrupt and rebuilt", (t) => {
  const { ctx } = repoWith(t);
  loadIndex(ctx);
  fs.writeFileSync(indexPath(ctx), "}{ garbage");
  const { stats } = loadIndex(ctx);
  assert.equal(stats.cache, "corrupt");
  assert.equal(stats.parsed, IDS.length);
  assert.equal(readIndex(ctx).version, INDEX_VERSION);
  assert.equal(loadIndex(ctx).stats.cache, "ok");
});

test("a foreign index version is rebuilt", (t) => {
  const { ctx } = repoWith(t);
  loadIndex(ctx);
  const data = readIndex(ctx);
  writeIndex(ctx, { ...data, version: INDEX_VERSION + 1, builtAt: Date.now() + 600000 });
  const { stats } = loadIndex(ctx);
  assert.equal(stats.parsed, IDS.length);
  assert.notEqual(stats.cache, "ok");
  assert.equal(readIndex(ctx).version, INDEX_VERSION);
});

test("rebuild: true reparses everything", (t) => {
  const { ctx } = repoWith(t);
  loadIndex(ctx);
  const { stats } = loadIndex(ctx, { rebuild: true });
  assert.equal(stats.parsed, IDS.length);
  assert.equal(stats.reused, 0);
  assert.equal(stats.cache, "rebuild");
});

test("a malformed item appears in records with errors", (t) => {
  const { ctx, write } = repoWith(t);
  write("dk-00000009", "not an item at all\n");
  const { records } = loadIndex(ctx);
  const bad = records.find((r) => r.name === "dk-00000009.md");
  assert.ok(bad);
  assert.ok(bad.errors.length > 0);
  const good = records.filter((r) => r.name !== "dk-00000009.md");
  assert.ok(good.every((r) => r.errors.length === 0));
});

test("each worktree keeps its own index over its own item set", (t) => {
  const { root, dir, write, commit } = repoWith(t, ["dk-00000001"]);
  commit("one");
  const wt = path.join(dir, "linked wt");
  git(root, "worktree", "add", "-q", "-b", "feature", wt);
  write("dk-00000002", itemText({ id: "dk-00000002" })); // main only (uncommitted)
  fs.writeFileSync(
    path.join(wt, "docs", "items", "dk-00000007.md"),
    itemText({ id: "dk-00000007" }),
  );
  const mainCtx = resolveRepo(root);
  const wtCtx = resolveRepo(wt);
  const main = loadIndex(mainCtx);
  const linked = loadIndex(wtCtx);
  assert.deepEqual(main.records.map((r) => r.id).sort(), ["dk-00000001", "dk-00000002"]);
  assert.deepEqual(linked.records.map((r) => r.id).sort(), ["dk-00000001", "dk-00000007"]);
  assert.notEqual(indexPath(mainCtx), indexPath(wtCtx));
  assert.ok(fs.existsSync(path.join(wt, ".docket", "index.json")));
  assert.deepEqual(Object.keys(readIndex(wtCtx).files).sort(), [
    "dk-00000001.md",
    "dk-00000007.md",
  ]);
});

test("check never trusts the index", { timeout: 120000 }, (t) => {
  const { root, ctx, write } = repoWith(t);
  const clean = runCli(["check", "--repo", root]);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  loadIndex(ctx);
  // Poison the cache: pretend every file is fine, then break one file for real.
  write("dk-00000002", "garbage, not an item\n");
  const data = readIndex(ctx);
  data.builtAt = Date.now() + 600000;
  data.files["dk-00000002.md"] = {
    ...data.files["dk-00000001.md"],
    name: "dk-00000002.md",
    id: "dk-00000002",
  };
  writeIndex(ctx, data);
  const result = runCli(["check", "--repo", root]);
  assert.notEqual(result.status, 0, result.stdout);
});

test("the index command reports stats; --rebuild parses everything", { timeout: 120000 }, (t) => {
  const { root } = repoWith(t);
  const first = runCli(["index", "--repo", root, "--json"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.json.data.total, IDS.length);
  assert.equal(first.json.data.parsed, IDS.length);
  const again = runCli(["index", "--repo", root, "--json"]);
  assert.equal(again.json.data.parsed, 0);
  const rebuilt = runCli(["index", "--repo", root, "--rebuild", "--json"]);
  assert.equal(rebuilt.json.data.parsed, IDS.length);
  assert.equal(rebuilt.json.data.reused, 0);
});
