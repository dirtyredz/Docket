import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { itemText } from "../helpers/repository.mjs";
import { addWorktree, appData, docketRepo, register, viewer } from "../helpers/viewer.mjs";

const hex = (n) => `dk-${n.toString(16).padStart(8, "0")}`;
const letter = (n) => String.fromCharCode(97 + n);
const rank = (n) => letter(Math.floor(n / 26)) + letter(n % 26);
const item = (n, fields = {}, title = `Item ${n}`) =>
  itemText({ id: hex(n), rank: rank(n), ...fields }, { title });

/** Items from [[priority, status], ...] keyed by id. */
function items(specs) {
  const out = {};
  specs.forEach(([priority, status], i) => {
    out[hex(i + 1)] = item(i + 1, { priority, status });
  });
  return out;
}

async function start(t, setup) {
  const data = appData();
  const cleanups = [data.cleanup];
  const track = (fn) => cleanups.push(fn);
  setup?.(data, track);
  const v = await viewer(data.registryFile);
  t.after(async () => {
    await v.close();
    for (const c of cleanups) c();
  });
  return { v, data, track };
}

const byAlias = (o, alias) => o.repos.find((r) => r.alias === alias);

test("counts by priority and status, zero buckets present, closed excluded", async (t) => {
  const { v } = await start(t, (data, track) => {
    const r = docketRepo(
      items([
        ["P0", "todo"],
        ["P0", "wip"],
        ["P2", "todo"],
        ["P2", "done"],
        ["P3", "dropped"],
      ]),
    );
    track(r.cleanup);
    register(data.registryFile, r.root, { alias: "alpha" });
  });
  const o = await v.settled();
  const row = byAlias(o, "alpha");
  assert.equal(row.state, "ready");
  assert.deepEqual(row.counts, {
    P0: 2,
    P1: 0,
    P2: 1,
    P3: 0,
    todo: 2,
    wip: 1,
    open: 3,
    openNotes: 0,
    discussion: 0,
  });
  assert.equal(row.invalid, 0);
  assert.deepEqual(o.coverage, { total: 1, ready: 1, loading: 0, unavailable: 0 });
});

test("invalid items are reported", async (t) => {
  const { v } = await start(t, (data, track) => {
    const r = docketRepo(items([["P1", "todo"]]));
    r.write("dk-0000bad1", "not an item\n");
    r.commit("bad");
    track(r.cleanup);
    register(data.registryFile, r.root, { alias: "alpha" });
  });
  const row = byAlias(await v.settled(), "alpha");
  assert.equal(row.invalid, 1);
  assert.equal(row.counts.open, 1);
});

test("an unavailable repo stays listed with a reason", async (t) => {
  const { v } = await start(t, (data, track) => {
    const good = docketRepo(items([["P1", "todo"]]));
    const gone = docketRepo(items([["P1", "todo"]]));
    track(good.cleanup);
    register(data.registryFile, good.root, { alias: "good" });
    register(data.registryFile, gone.root, { alias: "gone" });
    gone.cleanup();
  });
  const o = await v.settled();
  assert.equal(o.repos.length, 2);
  const gone = byAlias(o, "gone");
  assert.equal(gone.state, "unavailable");
  assert.ok(gone.reason);
  assert.equal(byAlias(o, "good").state, "ready");
  assert.equal(o.coverage.unavailable, 1);
});

test("a linked worktree does not double count; the preferred checkout drives counts", async (t) => {
  let wt;
  const { v, data } = await start(t, (d, track) => {
    const main = docketRepo(items([["P1", "todo"]]));
    track(main.cleanup);
    wt = addWorktree(main, "wt");
    fs.writeFileSync(path.join(wt, "docs", "items", `${hex(50)}.md`), item(50, { priority: "P0" }));
    register(d.registryFile, main.root, { alias: "alpha" });
    register(d.registryFile, wt, { alias: "alpha" });
  });
  let o = await v.settled();
  assert.equal(o.repos.length, 1);
  assert.equal(o.repos[0].checkouts.length, 2);
  assert.equal(o.repos[0].counts.open, 1);
  assert.equal(o.repos[0].counts.P0, 0);

  register(data.registryFile, wt, { alias: "alpha", prefer: true });
  await v.get("/api/repos?refresh=1&force=1");
  o = await v.settled();
  assert.equal(o.repos.length, 1);
  assert.equal(o.repos[0].counts.open, 2);
  assert.equal(o.repos[0].counts.P0, 1);
});

test("counts are complete beyond 500 items", async (t) => {
  const { v } = await start(t, (data, track) => {
    const r = docketRepo({});
    track(r.cleanup);
    for (let i = 1; i <= 650; i += 1) r.write(hex(i), item(i, { priority: `P${i % 4}` }));
    r.commit("many");
    register(data.registryFile, r.root, { alias: "big" });
  });
  const row = byAlias(await v.settled(), "big");
  assert.equal(row.counts.open, 650);
  assert.equal(row.counts.P0 + row.counts.P1 + row.counts.P2 + row.counts.P3, 650);
});

test("registry changes appear without a restart", async (t) => {
  const { v, data, track } = await start(t, (d, tr) => {
    const r = docketRepo(items([["P1", "todo"]]));
    tr(r.cleanup);
    register(d.registryFile, r.root, { alias: "first" });
  });
  assert.equal((await v.settled()).repos.length, 1);
  const second = docketRepo(items([["P0", "todo"]]));
  track(second.cleanup);
  register(data.registryFile, second.root, { alias: "second" });
  await v.get("/api/repos?refresh=1&force=1");
  const o = await v.settled();
  assert.equal(o.repos.length, 2);
  assert.equal(byAlias(o, "second").counts.P0, 1);
});

test("an empty registry lists no repos", async (t) => {
  const { v } = await start(t);
  const o = await v.settled();
  assert.deepEqual(o.repos, []);
  assert.equal(o.coverage.total, 0);
});

const noted = (n, state = "open", fields = {}) =>
  itemText(
    { id: hex(n), rank: rank(n), ...fields },
    {
      title: `Item ${n}`,
      body: `Facts.\n\n## Notes\n\n### 2026-10-05T14:03:00.${String(n).padStart(3, "0")}Z · ${state} · owner\n\nQuestion.\n`,
    },
  );

test("openNotes and discussion count every status, from the preferred checkout only", async (t) => {
  let wt;
  const { v, data } = await start(t, (d, track) => {
    const main = docketRepo({
      [hex(1)]: noted(1),
      [hex(2)]: noted(2, "open", { status: "done" }),
      [hex(3)]: noted(3, "resolved"),
      [hex(4)]: item(4),
    });
    track(main.cleanup);
    wt = addWorktree(main, "wt");
    fs.writeFileSync(path.join(wt, "docs", "items", `${hex(4)}.md`), noted(4));
    fs.writeFileSync(path.join(wt, "docs", "items", `${hex(5)}.md`), noted(5));
    register(d.registryFile, main.root, { alias: "alpha" });
    register(d.registryFile, wt, { alias: "alpha" });
  });
  let o = await v.settled();
  assert.equal(o.repos.length, 1);
  assert.equal(o.repos[0].counts.openNotes, 2);
  assert.equal(o.repos[0].counts.discussion, 2);
  assert.equal(o.repos[0].counts.open, 3); // the done item is not open work, yet its note counts

  register(data.registryFile, wt, { alias: "alpha", prefer: true });
  await v.get("/api/repos?refresh=1&force=1");
  o = await v.settled();
  assert.equal(o.repos[0].counts.openNotes, 4);
  assert.equal(o.repos[0].counts.discussion, 4);
});
