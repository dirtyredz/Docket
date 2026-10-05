// 0.4.0 move-in ergonomics: stdin bodies, batch add, count-by, rank column, per-command help.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { itemText, makeRepo, readItem, runCli } from "../helpers/repository.mjs";

const repos = [];
const repo = (items) => {
  const r = makeRepo(items);
  repos.push(r);
  return r;
};
after(() => repos.forEach((r) => r.cleanup()));

const run = (r, args, opts) => runCli([...args, "--json", "--repo", r.root], opts);
const files = (r) => {
  const dir = path.join(r.root, "docs", "items");
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};
const ADD = ["add", "--type", "task", "--priority", "P2", "--title", "S"];

describe("add", () => {
  test("--body-file - reads the body from stdin", () => {
    const r = repo();
    const out = run(r, [...ADD, "--body-file", "-"], { input: "From stdin ü\n\nSecond\n" });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(readItem(r.root, out.json.data.id), /# S\n\nFrom stdin ü\n\nSecond\n$/);
  });

  test("--json returns id, title, type, status, priority, rank; --status is honoured, since is today", () => {
    const r = repo();
    const out = run(r, [
      "add",
      "--type",
      "bug",
      "--priority",
      "P1",
      "--title",
      "T",
      "--status",
      "done",
    ]);
    const d = out.json.data;
    assert.equal(d.status, "done");
    assert.equal(d.type, "bug");
    assert.equal(d.priority, "P1");
    assert.equal(d.title, "T");
    assert.ok(d.rank);
    assert.equal(d.since, d.created);
  });

  test("an invalid --status is a usage error and writes nothing", () => {
    const r = repo();
    const out = run(r, [...ADD, "--status", "nope"]);
    assert.equal(out.status, 2);
    assert.deepEqual(files(r), []);
  });
});

describe("add --batch", () => {
  const batch = [
    { type: "bug", priority: "P1", title: "First", body: "One\n", area: "cli" },
    { type: "task", priority: "P1", title: "Second", status: "done" },
    { type: "idea", priority: "P3", title: "Third" },
  ];

  test("creates every item from stdin, ranks in array order, returns the created list", () => {
    const r = repo();
    const out = run(r, ["add", "--batch", "-"], { input: JSON.stringify(batch) });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const items = out.json.data.items;
    assert.equal(out.json.data.count, 3);
    assert.deepEqual(
      items.map((i) => i.title),
      ["First", "Second", "Third"],
    );
    assert.equal(items[1].status, "done");
    assert.ok(items[0].rank < items[1].rank, "same band keeps array order");
    assert.equal(new Set(items.map((i) => i.id)).size, 3);
    assert.equal(files(r).length, 3);
    assert.match(readItem(r.root, items[0].id), /area: cli[\s\S]*# First\n\nOne\n$/);
    assert.equal(runCli(["check", "--repo", r.root]).status, 0);
  });

  test("reads a file and ranks after existing items in the band", () => {
    const r = repo({ "dk-aaaaaaaa": itemText({ id: "dk-aaaaaaaa", priority: "P1", rank: "n" }) });
    const file = path.join(r.dir, "batch.json");
    fs.writeFileSync(file, JSON.stringify(batch.slice(0, 1)));
    const out = run(r, ["add", "--batch", file]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.ok(out.json.data.items[0].rank > "n");
  });

  test("human output is one id-and-title line per item", () => {
    const r = repo();
    const out = runCli(["add", "--batch", "-", "--repo", r.root], { input: JSON.stringify(batch) });
    const id = "dk-[0-9a-f]{8}";
    assert.match(out.stdout, new RegExp(`^${id} {2}First\\n${id} {2}Second\\n${id} {2}Third\\n$`));
  });

  const bad = {
    "invalid JSON": "{nope",
    "not an array": "{}",
    "empty array": "[]",
    "unknown key": JSON.stringify([batch[0], { ...batch[2], rank: "a" }]),
    "bad enum in the last entry": JSON.stringify([batch[0], { ...batch[2], priority: "P9" }]),
    "bad status in the last entry": JSON.stringify([batch[0], { ...batch[2], status: "x" }]),
    "multi-line title": JSON.stringify([batch[0], { ...batch[2], title: "a\nb" }]),
    "non-string body": JSON.stringify([batch[0], { ...batch[2], body: 5 }]),
    "missing title": JSON.stringify([batch[0], { type: "task", priority: "P2" }]),
  };
  for (const [name, input] of Object.entries(bad)) {
    test(`all-or-nothing: ${name} writes no item`, () => {
      const r = repo();
      const out = run(r, ["add", "--batch", "-"], { input });
      assert.notEqual(out.status, 0);
      assert.equal(out.json.ok, false);
      assert.deepEqual(files(r), []);
    });
  }

  test("the failing entry is named by index", () => {
    const r = repo();
    const input = JSON.stringify([batch[0], { ...batch[2], priority: "P9" }]);
    const out = run(r, ["add", "--batch", "-"], { input });
    assert.match(out.json.error.message, /batch\[1\]/);
  });

  test("cannot be combined with single-item options; a missing file is a usage error", () => {
    const r = repo();
    assert.equal(run(r, ["add", "--batch", "-", "--title", "x"], { input: "[]" }).status, 2);
    assert.equal(run(r, ["add", "--batch", path.join(r.dir, "none.json")]).status, 2);
    assert.deepEqual(files(r), []);
  });
});

describe("list", () => {
  const f = (id, status, type, priority, rank) => itemText({ id, status, type, priority, rank });
  const items = () => ({
    "dk-aaaaaaaa": f("dk-aaaaaaaa", "todo", "bug", "P0", "a"),
    "dk-bbbbbbbb": f("dk-bbbbbbbb", "wip", "task", "P1", "b"),
    "dk-cccccccc": f("dk-cccccccc", "done", "task", "P1", "c"),
    "dk-dddddddd": f("dk-dddddddd", "dropped", "idea", "P3", "d"),
  });
  const counts = (r, ...args) => run(r, ["list", ...args]).json.data.counts;

  test("--count-by status counts every status with --all, zeros included", () => {
    const r = repo(items());
    const d = run(r, ["list", "--all", "--count-by", "status"]).json.data;
    assert.deepEqual(d.counts, { todo: 1, wip: 1, done: 1, dropped: 1 });
    assert.equal(d.total, 4);
    assert.equal(d.countBy, "status");
  });

  test("--count-by respects the default open view; type and priority work", () => {
    const r = repo(items());
    assert.deepEqual(counts(r, "--count-by", "status"), { todo: 1, wip: 1, done: 0, dropped: 0 });
    const types = counts(r, "--all", "--count-by", "type");
    assert.deepEqual(types, { feature: 0, bug: 1, task: 2, idea: 1 });
    const prios = counts(r, "--all", "--count-by", "priority");
    assert.deepEqual(prios, { P0: 1, P1: 2, P2: 0, P3: 1 });
  });

  test("--count-by is not limited by --limit; text mode prints counts and a total", () => {
    const r = repo(items());
    const out = runCli(["list", "--all", "--limit", "1", "--count-by", "status", "--repo", r.root]);
    assert.match(out.stdout, /todo\s+1\nwip\s+1\ndone\s+1\ndropped\s+1\ntotal\s+4\n/);
  });

  test("--count-by rejects an unknown field", () => {
    const r = repo(items());
    assert.equal(run(r, ["list", "--count-by", "area"]).status, 2);
  });

  test("rank column is hidden by default and shown with --rank", () => {
    const r = repo(items());
    const plain = runCli(["list", "--repo", r.root]).stdout.split("\n")[0];
    assert.match(plain, /^dk-aaaaaaaa {2}P0 todo {4}bug/);
    const ranked = runCli(["list", "--rank", "--repo", r.root]).stdout.split("\n")[0];
    assert.match(ranked, /^dk-aaaaaaaa {2}P0 a {4}todo/);
  });
});

describe("per-command help", () => {
  test("add --help lists the allowed enum values and is not the global help", () => {
    const out = runCli(["add", "--help"]);
    assert.equal(out.status, 0);
    assert.match(out.stdout, /^Usage: docket add/);
    assert.match(out.stdout, /type\s+feature \| bug \| task \| idea/);
    assert.match(out.stdout, /status\s+todo \| wip \| done \| dropped/);
    assert.match(out.stdout, /priority\s+P0 \| P1 \| P2 \| P3/);
    assert.match(out.stdout, /--batch/);
    assert.doesNotMatch(out.stdout, /Markdown work items per repo/);
  });

  test("every command has its own help, also via `help <command>`", () => {
    const all = [
      "init",
      "check",
      "add",
      "set",
      "link",
      "list",
      "show",
      "index",
      "claim",
      "release",
      "gate",
    ];
    for (const c of all) {
      const out = runCli([c, "--help"]);
      assert.match(out.stdout, new RegExp(`^Usage: docket ${c}`), c);
      assert.equal(runCli(["help", c]).stdout, out.stdout, c);
    }
    assert.match(runCli(["list", "-h"]).stdout, /--count-by/);
    assert.match(runCli(["init", "--help"]).stdout, /--dry-run/);
  });

  test("global help still works", () => {
    assert.match(runCli(["--help"]).stdout, /Markdown work items per repo/);
  });
});
