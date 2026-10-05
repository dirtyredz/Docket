import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { git, itemText, runCli } from "../helpers/repository.mjs";
import { addWorktree, appData, docketRepo, register, viewer } from "../helpers/viewer.mjs";

const hex = (n) => `dk-${n.toString(16).padStart(8, "0")}`;
const item = (n, fields = {}, opts = {}) =>
  itemText({ id: hex(n), rank: "n", ...fields }, { title: `Item ${n}`, ...opts });

/** Disposable app data + server; `setup(data, track)` builds repos before the server starts. */
async function start(t, setup) {
  const data = appData();
  const cleanups = [data.cleanup];
  const track = (fn) => cleanups.push(fn);
  const ctx = setup?.(data, track);
  const v = await viewer(data.registryFile);
  t.after(async () => {
    await v.close();
    for (const c of cleanups) c();
  });
  return { v, data, track, ...ctx };
}

const base = (reg) => `/api/repos/${reg.repo.id}/checkouts/${reg.checkout.id}`;

function oneRepo(items, { alias = "alpha" } = {}) {
  return (data, track) => {
    const r = docketRepo(items);
    track(r.cleanup);
    return { r, reg: register(data.registryFile, r.root, { alias }) };
  };
}

test("board order: priority, then rank bytewise, then id; closed items present", async (t) => {
  const { v, reg } = await start(
    t,
    oneRepo({
      [hex(1)]: item(1, { priority: "P1", rank: "b" }),
      [hex(2)]: item(2, { priority: "P0", rank: "z" }),
      [hex(3)]: item(3, { priority: "P1", rank: "aa" }),
      [hex(4)]: item(4, { priority: "P1", rank: "a" }),
      [hex(6)]: item(6, { priority: "P2", rank: "n", status: "done" }),
      [hex(5)]: item(5, { priority: "P2", rank: "n", status: "dropped" }),
    }),
  );
  const r = await v.get(`${base(reg)}/items`);
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.json.items.map((i) => i.id),
    [hex(2), hex(4), hex(3), hex(1), hex(5), hex(6)],
  );
  const status = Object.fromEntries(r.json.items.map((i) => [i.id, i.status]));
  assert.equal(status[hex(5)], "dropped");
  assert.equal(status[hex(6)], "done");
  assert.equal(r.json.items[0].title, "Item 2");
  assert.equal(r.json.repo.id, reg.repo.id);
  assert.equal(r.json.checkout.id, reg.checkout.id);
  assert.ok(r.json.loadedAt);
});

test("blocked: open blocker, done blocker, nonexistent blocker", async (t) => {
  const { v, reg } = await start(
    t,
    oneRepo({
      [hex(1)]: item(1, { status: "todo" }),
      [hex(2)]: item(2, { status: "done" }),
      [hex(3)]: item(3, { blocked_by: [hex(1)] }),
      [hex(4)]: item(4, { blocked_by: [hex(2)] }),
      [hex(5)]: item(5, { blocked_by: ["dk-0000dead"] }),
    }),
  );
  const board = (await v.get(`${base(reg)}/items`)).json.items;
  const blocked = Object.fromEntries(board.map((i) => [i.id, i.blocked]));
  assert.equal(blocked[hex(3)], true);
  assert.equal(blocked[hex(4)], false);
  assert.equal(blocked[hex(5)], true);
  assert.equal(blocked[hex(1)], false);
  for (const [n, want] of [
    [3, true],
    [4, false],
    [5, true],
  ]) {
    assert.equal((await v.get(`${base(reg)}/items/${hex(n)}`)).json.blocked, want);
  }
});

test("a malformed file is listed as invalid, not as an item", async (t) => {
  const { v, reg } = await start(t, (data, track) => {
    const r = docketRepo({ [hex(1)]: item(1) });
    track(r.cleanup);
    r.write("dk-0000bad1", "not an item\n");
    r.commit("bad");
    return { reg: register(data.registryFile, r.root) };
  });
  const r = (await v.get(`${base(reg)}/items`)).json;
  assert.deepEqual(
    r.items.map((i) => i.id),
    [hex(1)],
  );
  assert.equal(r.invalid.length, 1);
  assert.match(JSON.stringify(r.invalid), /dk-0000bad1/);
});

test("detail reads fresh bytes from disk without a commit", async (t) => {
  const { v, reg, r } = await start(t, oneRepo({ [hex(1)]: item(1) }));
  const url = `${base(reg)}/items/${hex(1)}`;
  await v.get(`${base(reg)}/items`);
  const before = (await v.get(url)).json;
  assert.equal(before.title, "Item 1");
  assert.equal(before.status, "todo");
  assert.equal(typeof before.revision, "string");
  r.write(hex(1), item(1, { status: "wip" }, { title: "Renamed on disk" }));
  const after = (await v.get(url)).json;
  assert.equal(after.title, "Renamed on disk");
  assert.equal(after.status, "wip");
  assert.notEqual(after.revision, before.revision);
});

test("unknown id is 404; malformed ids are 400", async (t) => {
  const { v, reg } = await start(t, oneRepo({ [hex(1)]: item(1) }));
  const url = `${base(reg)}/items`;
  const missing = await v.get(`${url}/dk-0000dead`);
  assert.equal(missing.status, 404);
  assert.ok(missing.json.error.code);
  assert.ok(missing.json.error.message);
  for (const bad of ["dk-xyz", "..%2f..%2fpackage.json", "DK-00000001", "dk-0000000"]) {
    const r = await v.get(`${url}/${bad}`);
    assert.equal(r.status, 400, bad);
    assert.ok(r.json.error.code);
  }
});

test("ids are scoped by checkout and a checkout id does not cross repos", async (t) => {
  const { v, mainReg, wtReg, other } = await start(t, (data, track) => {
    const main = docketRepo({ [hex(1)]: item(1) });
    track(main.cleanup);
    const wt = addWorktree(main, "wt");
    fs.writeFileSync(path.join(wt, "docs", "items", `${hex(9)}.md`), item(9));
    git(wt, "config", "user.email", "test@docket");
    git(wt, "config", "user.name", "test");
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "extra");
    const otherRepo = docketRepo({ [hex(2)]: item(2) });
    track(otherRepo.cleanup);
    return {
      mainReg: register(data.registryFile, main.root, { alias: "alpha" }),
      wtReg: register(data.registryFile, wt, { alias: "alpha" }),
      other: register(data.registryFile, otherRepo.root, { alias: "beta" }),
    };
  });
  assert.equal(mainReg.repo.id, wtReg.repo.id);
  const ids = async (reg) => (await v.get(`${base(reg)}/items`)).json.items.map((i) => i.id);
  assert.deepEqual(await ids(wtReg), [hex(1), hex(9)]);
  assert.deepEqual(await ids(mainReg), [hex(1)]);
  assert.equal((await v.get(`${base(mainReg)}/items/${hex(9)}`)).status, 404);
  assert.equal((await v.get(`${base(wtReg)}/items/${hex(9)}`)).status, 200);

  const cross = await v.get(`/api/repos/${other.repo.id}/checkouts/${wtReg.checkout.id}/items`);
  assert.equal(cross.status, 404);
  const crossDetail = await v.get(
    `/api/repos/${other.repo.id}/checkouts/${wtReg.checkout.id}/items/${hex(9)}`,
  );
  assert.equal(crossDetail.status, 404);
});

test("a claim made through the CLI shows in detail", async (t) => {
  const { v, reg, r } = await start(t, oneRepo({ [hex(1)]: item(1) }));
  const url = `${base(reg)}/items/${hex(1)}`;
  assert.equal((await v.get(url)).json.claim, null);
  const c = runCli(["claim", hex(1), "--repo", r.root]);
  assert.equal(c.status, 0, c.stderr);
  const claim = (await v.get(url)).json.claim;
  assert.ok(claim);
  assert.ok(claim.worktree);
  assert.ok(claim.at);
});

const PAYLOAD = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '<iframe src="https://x"></iframe>',
  "[x](javascript:alert(1))",
  '<a href="//evil.example">p</a>',
  "<form><input name=a></form>",
  "<style>body{}</style>",
  '<div onclick="x">d</div>',
  "[ok](https://example.com)",
].join("\n\n");

test("item body HTML is sanitized", async (t) => {
  const { v, reg } = await start(t, oneRepo({ [hex(1)]: item(1, {}, { body: `${PAYLOAD}\n` }) }));
  const r = await v.get(`${base(reg)}/items/${hex(1)}`);
  assert.equal(r.status, 200);
  const html = r.json.bodyHtml.replace(/ title="[^"]*"/g, ""); // inert title text may quote the link
  for (const bad of [
    "<script",
    "onerror",
    "<iframe",
    "javascript:",
    "<form",
    "<style",
    "onclick",
    "<img",
    'href="//evil',
  ]) {
    assert.ok(!html.includes(bad), `html must not contain ${bad}: ${html}`);
  }
  assert.ok(html.includes('<a href="https://example.com"'), html);
});
