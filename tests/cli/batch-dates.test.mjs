// 0.4.2: `add --batch` entries may carry historical created/since dates for move-ins.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { localDate } from "../../src/core/identity/date.mjs";
import { makeRepo, readItem, runCli } from "../helpers/repository.mjs";

const repos = [];
const repo = () => {
  const r = makeRepo();
  repos.push(r);
  return r;
};
after(() => repos.forEach((r) => r.cleanup()));

const base = { type: "task", priority: "P2", title: "Moved" };
const run = (r, entries) =>
  runCli(["add", "--batch", "-", "--json", "--repo", r.root], { input: JSON.stringify(entries) });
const count = (r) => {
  const dir = path.join(r.root, "docs", "items");
  return fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
};

describe("add --batch dates", () => {
  const bad = {
    "not a calendar date": { created: "2026-02-30" },
    "wrong format": { since: "08/22/2026" },
    "future created": { created: "2999-01-01" },
    "future since": { since: "2999-01-01" },
    "since before created": { created: "2026-08-22", since: "2026-08-01" },
  };
  for (const [name, dates] of Object.entries(bad)) {
    test(`rejects ${name} and writes nothing`, () => {
      const r = repo();
      const out = run(r, [base, { ...base, title: "Bad", ...dates }]);
      assert.notEqual(out.status, 0);
      assert.match(JSON.parse(out.stdout).error.message, /batch\[1\]/);
      assert.equal(count(r), 0);
    });
  }

  test("writes the given dates; one date fills both; none keeps today", () => {
    const r = repo();
    const out = run(r, [
      { ...base, title: "Both", status: "done", created: "2026-08-01", since: "2026-08-22" },
      { ...base, title: "Since only", since: "2026-08-22" },
      { ...base, title: "Created only", created: "2026-08-01" },
      { ...base, title: "Neither" },
    ]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const [a, b, c, d] = JSON.parse(out.stdout).data.items;
    const today = localDate();
    assert.deepEqual([a.created, a.since], ["2026-08-01", "2026-08-22"]);
    assert.deepEqual([b.created, b.since], ["2026-08-22", "2026-08-22"]);
    assert.deepEqual([c.created, c.since], ["2026-08-01", "2026-08-01"]);
    assert.deepEqual([d.created, d.since], [today, today]);
    assert.match(readItem(r.root, a.id), /created: 2026-08-01\n[\s\S]*since: 2026-08-22\n/);
    assert.equal(runCli(["check", "--repo", r.root]).status, 0);
  });

  test("accepts today as a date", () => {
    const r = repo();
    const out = run(r, [{ ...base, created: localDate() }]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
  });
});
