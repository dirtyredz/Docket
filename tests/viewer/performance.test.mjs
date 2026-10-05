// Fleet-sized fixture: 29 repos, 1,500 items, one repo above 500. Measures cold overview completion
// (server start to every repo loaded, indexes built from nothing) and warm interaction latency, against
// the PLAN-VIEWER targets (5 s cold, 300 ms warm). Also: incomplete coverage is reported while loading,
// and the catalog never loads item bodies.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { createCatalog } from "../../src/viewer/server/catalog.mjs";
import { createCheckoutOpener, createRegistrySource } from "../../src/viewer/server/scope.mjs";
import { appData, docketRepo, register, viewer } from "../helpers/viewer.mjs";
import { itemText } from "../helpers/repository.mjs";

const REPOS = 29;
const BIG = 612;
const TOTAL = 1500;
const COLD_TARGET_MS = 5000;
const WARM_TARGET_MS = 300;
const STATUSES = ["todo", "todo", "wip", "done", "dropped"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];

const rank = (n) => {
  let s = "";
  for (let x = n + 26; x > 0; x = Math.floor(x / 26)) s = String.fromCharCode(97 + (x % 26)) + s;
  return s;
};

let home;
const repos = [];
let fixture;
before(() => {
  home = appData();
  let next = 1;
  const perSmall = Math.ceil((TOTAL - BIG) / (REPOS - 1));
  let remaining = TOTAL;
  for (let i = 0; i < REPOS; i++) {
    const count = i === 0 ? BIG : Math.min(perSmall, remaining);
    remaining -= count;
    const r = docketRepo({}, { prefix: `docket perf ${i} ` });
    const dir = path.join(r.root, "docs", "items");
    fs.mkdirSync(dir, { recursive: true });
    for (let k = 0; k < count; k++) {
      const id = `dk-${(next++).toString(16).padStart(8, "0")}`;
      const fields = {
        id,
        status: STATUSES[k % STATUSES.length],
        priority: PRIORITIES[k % PRIORITIES.length],
        rank: rank(k),
      };
      const body = `Body of ${id}. ${"Lorem ipsum dolor sit amet. ".repeat(8)}\n`;
      fs.writeFileSync(
        path.join(dir, `${id}.md`),
        itemText(fields, { title: `Item ${k} of repo ${i}`, body }),
      );
    }
    r.commit("items");
    repos.push({ r, count });
  }
  repos.forEach(({ r }, i) => register(home.registryFile, r.root, { alias: `perf-${i}` }));
  fixture = { total: TOTAL - remaining };
});
after(() => {
  repos.forEach(({ r }) => r.cleanup());
  home?.cleanup();
});

const timed = async (fn) => {
  const t0 = performance.now();
  const value = await fn();
  return { ms: performance.now() - t0, value };
};

test("cold overview completes within the target and counts every item", async (t) => {
  assert.equal(fixture.total, TOTAL);
  const { ms, value } = await timed(async () => {
    const v = await viewer(home.registryFile);
    const overview = await v.settled(60000);
    return { v, overview };
  });
  const { v, overview } = value;
  t.after(() => v.close());
  t.diagnostic(
    `cold overview (29 repos, ${TOTAL} items, indexes built from nothing): ${ms.toFixed(0)} ms`,
  );
  assert.equal(overview.coverage.ready, REPOS);
  const expectedOpen = Math.floor(BIG / 5) * 3 + Math.min(BIG % 5, 3); // todo, todo, wip of every 5
  const big = overview.repos.find((r) => r.counts.open === expectedOpen);
  assert.ok(big, "the >500-item repo reports complete open counts (no 500-item limit)");
  const board = await v.get(`/api/repos/${big.id}/checkouts/${big.preferred}/items`);
  assert.equal(board.json.items.length, BIG);
  const sum = overview.repos.reduce((n, r) => n + r.counts.open, 0);
  assert.ok(sum > 500 && sum < TOTAL);
  assert.ok(ms < COLD_TARGET_MS, `cold ${ms.toFixed(0)} ms exceeds ${COLD_TARGET_MS} ms`);
});

test("warm interactions stay within the target", async (t) => {
  const v = await viewer(home.registryFile);
  t.after(() => v.close());
  const overview = await v.settled(60000);
  const bigRepo = overview.repos.reduce((a, b) => (a.counts.open > b.counts.open ? a : b));
  const small = overview.repos.find((r) => r !== bigRepo);
  const board = (r) => `/api/repos/${r.id}/checkouts/${r.preferred}/items`;
  const firstId = (await v.get(board(bigRepo))).json.items[0].id;
  const cases = {
    overview: () => v.get("/api/repos"),
    search: () => v.get("/api/search?q=item%2042"),
    "search closed": () => v.get("/api/search?q=repo%207&closed=1"),
    "board (612 items)": () => v.get(board(bigRepo)),
    "board (small)": () => v.get(board(small)),
    detail: () => v.get(`${board(bigRepo)}/${firstId}`),
    relations: () => v.get(`${board(bigRepo)}/${firstId}/relations`),
  };
  const worst = {};
  for (const [name, fn] of Object.entries(cases)) {
    await fn(); // warm-up
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const { ms, value } = await timed(fn);
      assert.equal(value.status, 200, `${name}: ${value.text}`);
      runs.push(ms);
    }
    worst[name] = Math.max(...runs);
    t.diagnostic(`warm ${name}: max ${worst[name].toFixed(1)} ms over 5 runs`);
  }
  for (const [name, ms] of Object.entries(worst)) {
    assert.ok(ms < WARM_TARGET_MS, `${name} took ${ms.toFixed(0)} ms (target ${WARM_TARGET_MS})`);
  }
});

test("coverage is reported incomplete while repos are still loading", async () => {
  const registrySource = createRegistrySource(home.registryFile);
  let release;
  const gate = new Promise((r) => (release = r));
  let turns = 0;
  const catalog = createCatalog({
    registrySource,
    openCheckout: createCheckoutOpener(),
    yieldTurn: () => (++turns === 1 ? gate : Promise.resolve()),
  });
  const done = catalog.refresh({ force: true });
  await new Promise((r) => setImmediate(r));
  const partial = catalog.search("item");
  assert.equal(partial.complete, false);
  assert.equal(partial.coverage.ready, 1);
  assert.equal(partial.coverage.loading, REPOS - 1);
  assert.equal(catalog.overview().coverage.loading, REPOS - 1);
  release();
  await done;
  const full = catalog.search("item");
  assert.equal(full.complete, true);
  assert.equal(full.coverage.ready, REPOS);
});

test("the catalog holds summaries only, never bodies", async () => {
  const catalog = createCatalog({
    registrySource: createRegistrySource(home.registryFile),
    openCheckout: createCheckoutOpener(),
  });
  await catalog.refresh({ force: true });
  let seen = 0;
  for (const entry of catalog.entries.values()) {
    for (const item of entry.items) {
      seen++;
      assert.ok(!("body" in item) && !("rest" in item), `${item.id} carries a body`);
    }
  }
  assert.equal(seen, TOTAL);
});
