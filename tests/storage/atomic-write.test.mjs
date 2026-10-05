import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { atomicWrite } from "../../src/storage/atomic-write.mjs";
import { itemPath, writeItemFile } from "../../src/storage/item-store.mjs";
import { acquireLock, breakStale, withLock } from "../../src/storage/lock.mjs";
import { readWithRevision } from "../../src/storage/revision.mjs";
import { CLI, ROOT, itemText, makeRepo, runCli, tempDir } from "../helpers/repository.mjs";

const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
const fail = (code, times = Infinity) => {
  let n = 0;
  return () => {
    if (n++ < times) throw Object.assign(new Error(`injected ${code}`), { code });
  };
};
const noTemps = (dir) =>
  assert.deepEqual(
    fs.readdirSync(dir).filter((n) => n.endsWith(".tmp")),
    [],
  );

// Async child process so several overlap (spawnSync would serialise them).
function run(args, { script } = {}) {
  return new Promise((resolve, reject) => {
    const argv = script ? ["--input-type=module", "-e", script] : [CLI, ...args];
    const child = spawn(process.execPath, argv, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("atomicWrite replaces content and leaves no temp file", (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const file = path.join(dir, "a.txt");
  atomicWrite(file, "one");
  atomicWrite(file, "two");
  assert.equal(fs.readFileSync(file, "utf8"), "two");
  noTemps(dir);
});

test("createOnly refuses an existing file and keeps the original", (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const file = path.join(dir, "a.txt");
  atomicWrite(file, "original", { createOnly: true });
  assert.throws(() => atomicWrite(file, "other", { createOnly: true }), { code: "DOCKET_EXISTS" });
  assert.equal(fs.readFileSync(file, "utf8"), "original");
  noTemps(dir);
});

test("writeItemFile rejects a stale or null expectedRevision with DOCKET_CONFLICT", (t) => {
  const repo = makeRepo({ "dk-00000001": itemText() });
  t.after(repo.cleanup);
  const ctx = { itemsDir: path.join(repo.root, "docs", "items") };
  const file = itemPath(ctx, "dk-00000001");
  const before = fs.readFileSync(file);
  const actual = readWithRevision(file).revision;
  assert.throws(
    () => writeItemFile(ctx, "dk-00000001", "new", { expectedRevision: "deadbeefdeadbeef" }),
    (err) =>
      err.code === "DOCKET_CONFLICT" &&
      err.details.expected === "deadbeefdeadbeef" &&
      err.details.actual === actual,
  );
  assert.throws(() => writeItemFile(ctx, "dk-00000001", "new", { expectedRevision: null }), {
    code: "DOCKET_CONFLICT",
  });
  assert.deepEqual(fs.readFileSync(file), before);
  writeItemFile(ctx, "dk-00000001", "fresh", { expectedRevision: actual });
  assert.equal(fs.readFileSync(file, "utf8"), "fresh");
  noTemps(ctx.itemsDir);
});

test("rename failing transiently twice is retried (Windows)", (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const file = path.join(dir, "a.txt");
  const flaky = fail("EPERM", 2);
  let calls = 0;
  const ops = {
    rename: (from, to) => {
      calls++;
      flaky();
      fs.renameSync(from, to);
    },
    link: fs.linkSync,
  };
  atomicWrite(file, "ok", { ops, retry: { attempts: 3, delayMs: 1 } });
  assert.equal(calls, 3);
  assert.equal(fs.readFileSync(file, "utf8"), "ok");
  noTemps(dir);
});

test("permanently failing rename throws EPERM and leaves no temp file", (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const file = path.join(dir, "a.txt");
  fs.writeFileSync(file, "keep");
  const ops = { rename: fail("EPERM"), link: fs.linkSync };
  assert.throws(() => atomicWrite(file, "x", { ops, retry: { attempts: 3, delayMs: 1 } }), {
    code: "EPERM",
  });
  assert.equal(fs.readFileSync(file, "utf8"), "keep");
  noTemps(dir);
});

test("permanently failing link on createOnly throws EBUSY and leaves no temp file", (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const file = path.join(dir, "a.txt");
  const ops = { rename: fs.renameSync, link: fail("EBUSY") };
  assert.throws(
    () => atomicWrite(file, "x", { createOnly: true, ops, retry: { attempts: 3, delayMs: 1 } }),
    { code: "EBUSY" },
  );
  assert.equal(fs.existsSync(file), false);
  noTemps(dir);
});

test("non-transient rename errors are not retried", (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  let calls = 0;
  const ops = {
    rename: () => {
      calls++;
      throw Object.assign(new Error("boom"), { code: "ENOSPC" });
    },
    link: fs.linkSync,
  };
  assert.throws(() => atomicWrite(path.join(dir, "a"), "x", { ops }), { code: "ENOSPC" });
  assert.equal(calls, 1);
  noTemps(dir);
});

test("lock is exclusive and reusable after release", (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const lock = path.join(dir, "x.lock");
  const release = acquireLock(lock);
  assert.throws(() => acquireLock(lock, { timeoutMs: 200 }), { code: "DOCKET_LOCKED" });
  release();
  assert.equal(fs.existsSync(lock), false);
  assert.equal(
    withLock(lock, () => "done"),
    "done",
  );
  assert.equal(fs.existsSync(lock), false);
});

test("withLock releases when the callback throws", (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const lock = path.join(dir, "x.lock");
  assert.throws(
    () =>
      withLock(lock, () => {
        throw new Error("inner");
      }),
    /inner/,
  );
  assert.equal(fs.existsSync(lock), false);
});

test("a lock left by a dead pid is broken and retaken", (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const lock = path.join(dir, "x.lock");
  fs.writeFileSync(lock, JSON.stringify({ pid: 999999, at: new Date().toISOString() }));
  const release = acquireLock(lock, { timeoutMs: 2000 });
  assert.equal(JSON.parse(fs.readFileSync(lock, "utf8")).pid, process.pid);
  release();
});

test("concurrent writers under withLock lose no updates", { timeout: 120000 }, async (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const counter = path.join(dir, "counter.txt");
  const lock = path.join(dir, "counter.lock");
  fs.writeFileSync(counter, "0");
  const script = `
    import fs from "node:fs";
    import { withLock } from ${JSON.stringify(url("src/storage/lock.mjs"))};
    import { atomicWrite } from ${JSON.stringify(url("src/storage/atomic-write.mjs"))};
    const counter = ${JSON.stringify(counter)};
    const lock = ${JSON.stringify(lock)};
    for (let i = 0; i < 25; i++) {
      withLock(lock, () => {
        const n = Number(fs.readFileSync(counter, "utf8"));
        atomicWrite(counter, String(n + 1));
      }, { timeoutMs: 60000 });
    }
  `;
  const results = await Promise.all([1, 2, 3, 4].map(() => run([], { script })));
  for (const r of results) assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(counter, "utf8"), "100");
  noTemps(dir);
});

test(
  "parallel add processes produce distinct ids and ranks and a clean check",
  { timeout: 180000 },
  async (t) => {
    const repo = makeRepo({ "dk-00000001": itemText() });
    t.after(repo.cleanup);
    repo.commit("seed");
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        run([
          "add",
          "--type",
          "task",
          "--priority",
          "P2",
          "--title",
          `T${n}`,
          "--repo",
          repo.root,
          "--json",
        ]),
      ),
    );
    const ids = [];
    const ranks = [];
    for (const r of results) {
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const data = JSON.parse(r.stdout).data;
      ids.push(data.id);
      ranks.push(data.rank);
    }
    assert.equal(new Set(ids).size, 4);
    assert.equal(new Set(ranks).size, 4);
    const check = runCli(["check", "--repo", repo.root]);
    assert.equal(check.status, 0, check.stdout + check.stderr);
  },
);

// Regression: a waiter judged a dead owner's lock stale, the owner's successor took a fresh lock, and
// the waiter's check-then-delete removed the fresh lock (two holders, lost update in parallel claims).
test("breaking a stale lock never deletes a fresh lock taken after the judgement", (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const lockPath = path.join(dir, "x.lock");
  const judged = JSON.stringify({ pid: 999999, at: "2020-01-01T00:00:00Z", token: "old" });
  const fresh = JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token: "new" });
  fs.writeFileSync(lockPath, fresh); // the old lock was released and re-taken meanwhile
  breakStale(lockPath, { content: judged });
  assert.equal(fs.readFileSync(lockPath, "utf8"), fresh);
  assert.deepEqual(fs.readdirSync(dir), ["x.lock"]);
  fs.writeFileSync(lockPath, judged); // still the judged lock: it is broken
  breakStale(lockPath, { content: judged });
  assert.deepEqual(fs.readdirSync(dir), []);
});
