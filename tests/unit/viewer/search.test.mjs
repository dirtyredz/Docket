import assert from "node:assert/strict";
import { test } from "node:test";
import { itemText, runCli } from "../../helpers/repository.mjs";
import { appData, docketRepo, register, viewer } from "../../helpers/viewer.mjs";

const mk = (id, rank, title, status = "todo") => itemText({ id, rank, status }, { title });

async function start(t, specs) {
  const data = appData();
  const cleanups = [data.cleanup];
  const repos = {};
  for (const [alias, files] of Object.entries(specs)) {
    const r = docketRepo(files);
    cleanups.push(r.cleanup);
    repos[alias] = { r, ...register(data.registryFile, r.root, { alias }) };
  }
  const v = await viewer(data.registryFile);
  t.after(async () => {
    await v.close();
    for (const c of cleanups) c();
  });
  await v.settled();
  return { v, data, repos };
}

const q = (s, extra = "") => `/api/search?q=${encodeURIComponent(s)}${extra}`;
const ids = (r) => r.json.results.map((x) => x.id);

test("search is repo-qualified and case-insensitive", async (t) => {
  const { v, repos } = await start(t, {
    alpha: { "dk-0000000a": mk("dk-0000000a", "a", "Fix Widget bug") },
    beta: {
      "dk-0000000b": mk("dk-0000000b", "a", "Other widget thing"),
      "dk-0000000c": mk("dk-0000000c", "b", "Unrelated"),
    },
  });
  const r = await v.get(q("WIDGET"));
  assert.equal(r.status, 200);
  assert.equal(r.json.results.length, 2);
  const a = r.json.results.find((x) => x.alias === "alpha");
  assert.equal(a.repoId, repos.alpha.repo.id);
  assert.equal(a.checkoutId, repos.alpha.checkout.id);
  assert.equal(a.id, "dk-0000000a");
  assert.equal(a.title, "Fix Widget bug");
  assert.equal(r.json.complete, true);
});

test("open only by default; closed=1 includes done and dropped", async (t) => {
  const { v } = await start(t, {
    alpha: {
      "dk-00000001": mk("dk-00000001", "a", "needle open"),
      "dk-00000002": mk("dk-00000002", "b", "needle done", "done"),
      "dk-00000003": mk("dk-00000003", "c", "needle dropped", "dropped"),
    },
  });
  assert.deepEqual(ids(await v.get(q("needle"))), ["dk-00000001"]);
  assert.equal((await v.get(q("needle", "&closed=1"))).json.results.length, 3);
});

test("empty query gives no results; overlong query is a 400", async (t) => {
  const { v } = await start(t, { alpha: { "dk-00000001": mk("dk-00000001", "a", "thing") } });
  assert.deepEqual((await v.get(q(""))).json.results, []);
  assert.deepEqual((await v.get(q("   "))).json.results, []);
  const long = await v.get(q("x".repeat(201)));
  assert.equal(long.status, 400);
  assert.equal(typeof long.json.error.code, "string");
  assert.equal((await v.get(q("x".repeat(200)))).status, 200);
});

test("coverage flags an unavailable repo as incomplete", async (t) => {
  const data = appData();
  const alpha = docketRepo({ "dk-00000001": mk("dk-00000001", "a", "findme") });
  const beta = docketRepo({ "dk-00000002": mk("dk-00000002", "a", "findme too") });
  register(data.registryFile, alpha.root, { alias: "alpha" });
  register(data.registryFile, beta.root, { alias: "beta" });
  beta.cleanup();
  const v = await viewer(data.registryFile);
  t.after(async () => {
    await v.close();
    alpha.cleanup();
    data.cleanup();
  });
  await v.settled();
  const r = (await v.get(q("findme"))).json;
  assert.equal(r.coverage.unavailable, 1);
  assert.equal(r.complete, false);
  assert.deepEqual(
    r.results.map((x) => x.alias),
    ["alpha"],
  );
});

// Regression: the opener cached verifications for 5s, hiding a checkout deleted while running.
test("a repo deleted while running becomes unavailable on forced refresh", async (t) => {
  const { v, repos } = await start(t, {
    alpha: { "dk-00000001": mk("dk-00000001", "a", "findme") },
    beta: { "dk-00000002": mk("dk-00000002", "a", "findme too") },
  });
  repos.beta.r.cleanup();
  await v.get("/api/repos?refresh=1&force=1");
  await v.settled();
  const r = (await v.get(q("findme"))).json;
  assert.equal(r.coverage.unavailable, 1);
  assert.equal(r.complete, false);
});

test("an edit through the CLI shows up after a forced refresh", async (t) => {
  const { v, repos } = await start(t, {
    alpha: { "dk-00000001": mk("dk-00000001", "a", "Old words") },
  });
  assert.equal((await v.get(q("New words"))).json.results.length, 0);
  const res = runCli(["set", "dk-00000001", "--title", "New words", "--repo", repos.alpha.r.root]);
  assert.equal(res.status, 0, res.stderr);
  await v.get("/api/repos?refresh=1&force=1");
  await v.settled();
  assert.deepEqual(ids(await v.get(q("New words"))), ["dk-00000001"]);
});
