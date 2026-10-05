// Command behaviour through real child processes: add, set, link, list, show, index, claim, release.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { localDate } from "../../src/core/identity/date.mjs";
import { itemText, makeRepo, readItem, runCli } from "../helpers/repository.mjs";

const A = "dk-aaaaaaaa";
const B = "dk-bbbbbbbb";
const C = "dk-cccccccc";
const repos = [];
const repo = (items) => {
  const r = makeRepo(items);
  repos.push(r);
  return r;
};
after(() => repos.forEach((r) => r.cleanup()));

const dk = (r, ...args) => runCli([...args, "--json", "--repo", r.root]);
const ok = (out) => {
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(out.json.ok, true);
  return out.json.data;
};
const ids = (data) => data.items.map((i) => i.id);

describe("add", () => {
  test("human mode prints the ID and title", () => {
    const r = repo();
    const out = runCli([
      "add",
      "--type",
      "task",
      "--priority",
      "P1",
      "--title",
      "Hi",
      "--repo",
      r.root,
    ]);
    assert.equal(out.status, 0);
    assert.match(out.stdout, /^dk-[0-9a-f]{8} {2}Hi\n$/);
    assert.equal(out.stderr, "");
  });

  test("json data has id, file, revision, all 12 fields and title", () => {
    const r = repo();
    const d = ok(
      dk(r, "add", "--type", "bug", "--priority", "P0", "--title", "Crash", "--area", "cli"),
    );
    const keys = ["id", "file", "revision", "title"];
    keys.push("type", "created", "status", "since", "area", "priority", "rank");
    keys.push("parent", "fixes", "blocked_by", "relates");
    for (const k of keys) assert.ok(k in d, `missing ${k}`);
    assert.equal(d.file, `docs/items/${d.id}.md`);
    assert.equal(d.status, "todo");
    assert.equal(d.created, localDate());
    assert.equal(d.area, "cli");
    assert.ok(readItem(r.root, d.id).includes("# Crash"));
  });

  test("Unicode title round-trips and is stored as UTF-8", () => {
    const r = repo();
    const title = "Ünïcødé ✓ 日本語";
    const { id } = ok(dk(r, "add", "--type", "task", "--priority", "P2", "--title", title));
    assert.equal(ok(dk(r, "show", id)).title, title);
    const bytes = fs.readFileSync(path.join(r.root, "docs", "items", `${id}.md`));
    assert.ok(bytes.toString("utf8").includes(`# ${title}`));
    assert.ok(bytes.includes(Buffer.from("日本語", "utf8")));
  });

  test("--body-file reads a file whose path has spaces", () => {
    const r = repo();
    const file = path.join(r.dir, "body file.md");
    fs.writeFileSync(file, "Line one\n\nLine ü two\n");
    const args = ["add", "--type", "task", "--priority", "P2", "--title", "B", "--body-file", file];
    const { id } = ok(dk(r, ...args));
    assert.equal(ok(dk(r, "show", id)).body, "Line one\n\nLine ü two\n");
  });

  test("--fixes, --blocked-by and --relates are repeatable", () => {
    const r = repo({
      [A]: itemText({ id: A, rank: "b" }),
      [B]: itemText({ id: B, type: "feature", rank: "c" }),
      [C]: itemText({ id: C, rank: "d" }),
    });
    const args = ["add", "--type", "bug", "--priority", "P1", "--title", "X"];
    args.push("--fixes", A, "--fixes", B, "--blocked-by", A, "--blocked-by", C);
    args.push("--relates", B, "--relates", C);
    const d = ok(dk(r, ...args));
    assert.deepEqual(d.fixes, [A, B]);
    assert.deepEqual(d.blocked_by, [A, C]);
    assert.deepEqual(d.relates, [B, C]);
    assert.equal(runCli(["check", "--repo", r.root]).status, 0);
  });
});

describe("set", () => {
  test("status change reports changed and sets since to today", () => {
    const r = repo({ [A]: itemText({ id: A }) });
    const d = ok(dk(r, "set", A, "--status", "wip"));
    assert.ok(d.changed.includes("status") && d.changed.includes("since"));
    assert.equal(d.noop, false);
    assert.equal(d.fields.since, localDate());
    assert.match(readItem(r.root, A), new RegExp(`since: ${localDate()}`));
    const human = runCli(["set", A, "--status", "done", "--repo", r.root]);
    assert.match(human.stdout, new RegExp(`^${A}: .*status`));
  });

  test("setting the same value is a noop", () => {
    const r = repo({ [A]: itemText({ id: A }) });
    const before = readItem(r.root, A);
    const d = ok(dk(r, "set", A, "--status", "todo"));
    assert.equal(d.noop, true);
    assert.deepEqual(d.changed, []);
    assert.equal(readItem(r.root, A), before);
  });

  test("--before, --after and --top reorder the list", () => {
    const r = repo({
      [A]: itemText({ id: A, rank: "b" }),
      [B]: itemText({ id: B, rank: "c" }),
      [C]: itemText({ id: C, rank: "d" }),
    });
    assert.deepEqual(ids(ok(dk(r, "list"))), [A, B, C]);
    ok(dk(r, "set", C, "--before", A));
    assert.deepEqual(ids(ok(dk(r, "list"))), [C, A, B]);
    ok(dk(r, "set", C, "--after", B));
    assert.deepEqual(ids(ok(dk(r, "list"))), [A, B, C]);
    ok(dk(r, "set", B, "--top"));
    assert.deepEqual(ids(ok(dk(r, "list"))), [B, A, C]);
  });
});

describe("link", () => {
  test("add and remove list relations, human output lists changes", () => {
    const r = repo({ [A]: itemText({ id: A, rank: "b" }), [B]: itemText({ id: B, rank: "c" }) });
    const add = runCli(["link", A, "--blocked-by", B, "--repo", r.root]);
    assert.equal(add.status, 0);
    assert.match(add.stdout, new RegExp(`${A}: add blocked_by ${B}`));
    assert.match(readItem(r.root, A), new RegExp(`blocked_by: \\[${B}\\]`));
    const rm = ok(dk(r, "link", A, "--blocked-by", B, "--remove"));
    assert.deepEqual(
      rm.changes.map((c) => c.op),
      ["remove"],
    );
    assert.match(readItem(r.root, A), /blocked_by: \[\]/);
  });

  test("relates is symmetric: reverse add is a no-op, remove edits the holder", () => {
    const r = repo({ [A]: itemText({ id: A, rank: "b" }), [B]: itemText({ id: B, rank: "c" }) });
    ok(dk(r, "link", A, "--relates", B));
    const again = ok(dk(r, "link", B, "--relates", A));
    assert.deepEqual(again.changes, []);
    assert.equal(runCli(["link", B, "--relates", A, "--repo", r.root]).stdout, `${B}: no change\n`);
    const rm = ok(dk(r, "link", B, "--relates", A, "--remove"));
    assert.equal(rm.changes[0].storedOn, A);
    assert.match(readItem(r.root, A), /relates: \[\]/);
  });

  test("parent set and --clear-parent", () => {
    const r = repo({ [A]: itemText({ id: A, rank: "b" }), [B]: itemText({ id: B, rank: "c" }) });
    ok(dk(r, "link", B, "--parent", A));
    assert.equal(ok(dk(r, "show", B)).parent, A);
    assert.deepEqual(ok(dk(r, "show", A)).reverse.children, [B]);
    const d = ok(dk(r, "link", B, "--clear-parent"));
    assert.equal(d.changes[0].op, "clear");
    assert.equal(ok(dk(r, "show", B)).parent, "");
  });
});

describe("list", () => {
  const D = "dk-dddddddd";
  const E = "dk-eeeeeeee";
  const fixture = () =>
    repo({
      [A]: itemText({ id: A, rank: "b", priority: "P2", type: "task", status: "todo" }),
      [B]: itemText({ id: B, rank: "c", priority: "P0", type: "bug", status: "wip" }),
      [C]: itemText({ id: C, rank: "d", priority: "P1", type: "feature", status: "done" }),
      [D]: itemText({ id: D, rank: "e", status: "dropped" }),
      [E]: itemText({ id: E, rank: "f", blocked_by: [A] }),
    });

  test("default hides done and dropped; --all shows them", () => {
    const r = fixture();
    assert.deepEqual(ids(ok(dk(r, "list"))), [B, A, E]);
    assert.equal(ok(dk(r, "list", "--all")).total, 5);
  });

  test("status, type, priority and blocked filters", () => {
    const r = fixture();
    assert.deepEqual(ids(ok(dk(r, "list", "--status", "wip"))), [B]);
    assert.deepEqual(ids(ok(dk(r, "list", "--status", "done"))), [C]);
    assert.deepEqual(ids(ok(dk(r, "list", "--type", "bug"))), [B]);
    assert.deepEqual(ids(ok(dk(r, "list", "--priority", "P0"))), [B]);
    assert.deepEqual(ids(ok(dk(r, "list", "--blocked"))), [E]);
    assert.equal(ok(dk(r, "list", "--status", "todo", "--status", "wip")).total, 3);
  });

  test("order is priority, rank, id; same rank is listed and flagged by check", () => {
    const r = repo({
      [C]: itemText({ id: C, rank: "m" }),
      [A]: itemText({ id: A, rank: "m" }),
      [B]: itemText({ id: B, rank: "a", priority: "P3" }),
    });
    assert.deepEqual(ids(ok(dk(r, "list"))), [A, C, B]);
    assert.match(JSON.stringify(dk(r, "check").json), /duplicate-rank/);
  });

  test("is bounded: default 50 of 60, --limit 5, bad limits exit 2", () => {
    const items = {};
    const letter = (n) => String.fromCharCode(97 + n);
    for (let i = 0; i < 60; i++) {
      const id = `dk-${i.toString(16).padStart(8, "0")}`;
      items[id] = itemText({ id, rank: `b${letter(Math.floor(i / 26))}${letter(i % 26)}` });
    }
    const r = repo(items);
    const d = ok(dk(r, "list"));
    assert.equal(d.returned, 50);
    assert.equal(d.items.length, 50);
    assert.equal(d.truncated, true);
    assert.equal(d.total, 60);
    assert.equal(ok(dk(r, "list", "--limit", "5")).items.length, 5);
    assert.equal(dk(r, "list", "--limit", "0").status, 2);
    assert.equal(dk(r, "list", "--limit", "9999").status, 2);
  });

  test("a malformed file lands in data.invalid and list still exits 0", () => {
    const r = repo({ [A]: itemText({ id: A }), "dk-badbad00": "not an item\n" });
    const out = dk(r, "list");
    const d = ok(out);
    assert.equal(d.invalid.length, 1);
    assert.match(d.invalid[0].file, /dk-badbad00/);
    assert.deepEqual(ids(d), [A]);
    assert.equal(out.json.warnings.length, 1);
  });
});

describe("show", () => {
  test("body, revision, reverse relations, blocked flag and claim", () => {
    const r = repo({
      [A]: itemText(
        { id: A, type: "feature", rank: "b" },
        { title: "Target", body: "Hello body\n" },
      ),
      [B]: itemText({ id: B, type: "bug", rank: "c", fixes: [A], blocked_by: [A], parent: A }),
      [C]: itemText({ id: C, rank: "d", relates: [A] }),
    });
    const a = ok(dk(r, "show", A));
    assert.equal(a.body, "Hello body\n");
    assert.match(a.revision, /\S/);
    assert.deepEqual(a.reverse, { children: [B], blocks: [B], fixedBy: [B], relates: [C] });
    assert.equal(a.blocked, false);
    assert.equal(a.claim, null);
    assert.equal(ok(dk(r, "show", B)).blocked, true);
    ok(dk(r, "claim", A));
    const claimed = ok(dk(r, "show", A));
    assert.ok(claimed.claim);
    assert.equal(path.resolve(claimed.claim.worktree), path.resolve(r.root));
  });
});

describe("index", () => {
  test("--json reports stats and a rebuild reparses everything", () => {
    const r = repo({ [A]: itemText({ id: A }), [B]: itemText({ id: B, rank: "c" }) });
    const first = ok(dk(r, "index"));
    assert.equal(first.total, 2);
    assert.equal(first.parsed + first.reused, 2);
    const second = ok(dk(r, "index"));
    assert.equal(second.reused, 2);
    assert.equal(second.parsed, 0);
    assert.equal(ok(dk(r, "index", "--rebuild")).parsed, 2);
  });
});

describe("claim and release", () => {
  test("release from the claiming checkout releases; unclaimed does not", () => {
    const r = repo({ [A]: itemText({ id: A }) });
    const c = ok(dk(r, "claim", A, "--agent", "tester"));
    assert.equal(c.id, A);
    assert.equal(c.claim.agent, "tester");
    assert.equal(c.tookOver, null);
    assert.equal(ok(dk(r, "release", A)).released, true);
    assert.equal(ok(dk(r, "release", A)).released, false);
    assert.equal(runCli(["release", A, "--repo", r.root]).stdout, `${A}: was not claimed\n`);
  });

  test("claiming a missing item is a not-found error", () => {
    const r = repo();
    assert.equal(dk(r, "claim", A).json.error.code, "DOCKET_NOT_FOUND");
  });
});
