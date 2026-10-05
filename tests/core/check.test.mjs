// checkSnapshot: one case per rule 1-9, errors vs warnings separation, and git-backed snapshots.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { checkSnapshot } from "../../src/core/validation/check.mjs";
import { resolveRepo } from "../../src/repository/context.mjs";
import { refSnapshot, workingSnapshot } from "../../src/repository/snapshot.mjs";
import { itemText, makeRepo } from "../helpers/repository.mjs";

const A = "dk-0000000a";
const B = "dk-0000000b";
const C = "dk-0000000c";
const L = "bl-0000000d";

/** In-memory file entry for item `id` built from field overrides. */
const item = (id, fields = {}, opts) => ({
  name: `${id}.md`,
  isFile: true,
  bytes: Buffer.from(itemText({ id, ...fields }, opts)),
});
const raw = (name, text) => ({ name, isFile: true, bytes: Buffer.from(text) });
const run = (entries, options, extra = {}) =>
  checkSnapshot({ source: "test", entries, ...extra }, options);
const codes = (list) => list.map((e) => e.code).sort();
const hasError = (r, code, file) =>
  r.errors.some((e) => e.code === code && (file === undefined || e.file === file));

describe("rule 1: file names and kinds", () => {
  test("a clean store passes; dk- and bl- cross-reference each other", () => {
    const r = run([
      item(A, { parent: L, relates: [L], rank: "a" }),
      item(L, { blocked_by: [A], rank: "b" }),
    ]);
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
  });

  for (const [label, name] of [
    ["README.md", "README.md"],
    ["uppercase prefix", "DK-0000000a.md"],
    ["too few hex digits", "dk-0000000.md"],
    ["too many hex digits", "dk-0000000aa.md"],
    ["uppercase hex", "dk-0000000A.md"],
  ]) {
    test(`bad filename: ${label}`, () => {
      const r = run([raw(name, itemText({ id: A }))]);
      assert.equal(r.ok, false);
      assert.ok(hasError(r, "filename", name));
    });
  }

  test("a directory entry is rejected", () => {
    const r = run([{ name: "sub", isFile: false }]);
    assert.equal(r.ok, false);
    assert.ok(hasError(r, "not-a-file", "sub"));
  });
});

describe("rules 2, 3, 5 via the parser", () => {
  test("missing fence and missing title are reported with their rules", () => {
    const r = run([raw(`${A}.md`, "no frontmatter\n")]);
    assert.ok(r.errors.some((e) => e.rule === 1 && e.code === "fence"));
    const text = itemText({ id: B }).replace("# Test item", "plain");
    assert.ok(hasError(run([raw(`${B}.md`, text)]), "title"));
  });
});

describe("rule 4: values", () => {
  test("id differing from the filename", () => {
    const r = run([raw(`${A}.md`, itemText({ id: B }))]);
    assert.ok(hasError(r, "id-filename", `${A}.md`));
  });

  test("bad enum values", () => {
    for (const fields of [{ type: "epic" }, { status: "open" }, { priority: "P9" }]) {
      assert.ok(hasError(run([item(A, fields)]), "enum"), JSON.stringify(fields));
    }
  });

  test("since before created", () => {
    const r = run([item(A, { created: "2026-03-01", since: "2026-02-01" })]);
    assert.ok(hasError(r, "since-before-created"));
  });
});

describe("rule 6: references", () => {
  test("dangling reference", () => {
    const r = run([item(A, { blocked_by: [B] })]);
    assert.ok(hasError(r, "dangling", `${A}.md`));
  });

  test("self-reference", () => {
    const r = run([item(A, { parent: A })]);
    assert.ok(hasError(r, "self-reference"));
    assert.ok(!hasError(r, "dangling"));
  });

  test("a self-reference is reported once, not also as a one-item cycle", () => {
    const r = run([item(A, { parent: A, blocked_by: [A] })]);
    assert.deepEqual(codes(r.errors), ["self-reference", "self-reference"]);
  });

  test("duplicate list member", () => {
    const r = run([item(A, { relates: [B, B] }), item(B, { rank: "o" })]);
    assert.deepEqual(codes(r.errors), ["duplicate-member"]);
  });
});

describe("rule 7: cycles", () => {
  test("parent cycle and blocked_by cycle are separate codes", () => {
    const parent = run([item(A, { parent: B }), item(B, { parent: A, rank: "o" })]);
    assert.deepEqual(codes(parent.errors), ["parent-cycle"]);
    const blocked = run([item(A, { blocked_by: [B] }), item(B, { blocked_by: [A], rank: "o" })]);
    assert.deepEqual(codes(blocked.errors), ["blocked_by-cycle"]);
  });

  test("a 3-item cycle is reported exactly once", () => {
    const r = run([
      item(A, { blocked_by: [B] }),
      item(B, { blocked_by: [C], rank: "o" }),
      item(C, { blocked_by: [A], rank: "p" }),
    ]);
    assert.deepEqual(codes(r.errors), ["blocked_by-cycle"]);
  });

  test("a chain without a cycle passes, and relates cycles are allowed", () => {
    const r = run([
      item(A, { parent: B, blocked_by: [B], relates: [B] }),
      item(B, { parent: C, blocked_by: [C], relates: [A], rank: "o" }),
      item(C, { rank: "p" }),
    ]);
    assert.deepEqual(r.errors, []);
  });
});

describe("rule 8: fixes legality", () => {
  test("fixes on a non-bug", () => {
    const r = run([item(A, { type: "task", fixes: [B] }), item(B, { type: "feature", rank: "o" })]);
    assert.deepEqual(codes(r.errors), ["fixes-on-non-bug"]);
  });

  test("fixes targeting an idea or a bug is rejected", () => {
    for (const targetType of ["idea", "bug"]) {
      const r = run([
        item(A, { type: "bug", fixes: [B] }),
        item(B, { type: targetType, rank: "o" }),
      ]);
      assert.deepEqual(codes(r.errors), ["fixes-target"], targetType);
    }
  });

  test("fixes targeting a feature or task is fine", () => {
    const r = run([
      item(A, { type: "bug", fixes: [B, C] }),
      item(B, { type: "feature", rank: "o" }),
      item(C, { type: "task", rank: "p" }),
    ]);
    assert.deepEqual(r.errors, []);
  });
});

describe("rule 9: warnings never fail the check", () => {
  const warned = (r) => codes(r.warnings);

  test("dropped-target", () => {
    const r = run([item(A, { relates: [B] }), item(B, { status: "dropped", rank: "o" })]);
    assert.equal(r.ok, true);
    assert.deepEqual(warned(r), ["dropped-target"]);
    assert.deepEqual(r.errors, []);
  });

  test("duplicate-rank warns once per item, same priority only", () => {
    const same = run([item(A, { rank: "m" }), item(B, { rank: "m" }), item(C, { rank: "m" })]);
    assert.equal(same.ok, true);
    assert.deepEqual(warned(same), ["duplicate-rank", "duplicate-rank", "duplicate-rank"]);
    const other = run([item(A, { rank: "m" }), item(B, { rank: "m", priority: "P1" })]);
    assert.deepEqual(other.warnings, []);
  });

  test("unclaimed-wip depends on claimedIds", () => {
    const entries = [item(A, { status: "wip" })];
    assert.deepEqual(warned(run(entries, { claimedIds: new Set() })), ["unclaimed-wip"]);
    assert.deepEqual(run(entries, { claimedIds: new Set([A]) }).warnings, []);
    assert.deepEqual(run(entries, { claimedIds: null }).warnings, []);
    assert.equal(run(entries, { claimedIds: new Set() }).ok, true);
  });

  test("future-since uses the today option", () => {
    const entries = [item(A, { since: "2026-06-01" })];
    assert.deepEqual(warned(run(entries, { today: "2026-05-31" })), ["future-since"]);
    assert.deepEqual(run(entries, { today: "2026-06-01" }).warnings, []);
    assert.deepEqual(run(entries, {}).warnings, []);
  });

  test("a store with errors and warnings keeps them apart", () => {
    const r = run([
      item(A, { relates: [B] }),
      item(B, { status: "dropped", relates: [B], rank: "o" }),
    ]);
    assert.equal(r.ok, false);
    assert.deepEqual(codes(r.errors), ["self-reference"]);
    assert.ok(warned(r).includes("dropped-target"));
    assert.ok(r.warnings.every((w) => w.rule === 9));
  });
});

describe("snapshot configError", () => {
  test("is reported as an error against docket.json", () => {
    const configError = { rule: 0, code: "config", message: "not valid JSON" };
    const r = run([item(A)], undefined, { configError });
    assert.equal(r.ok, false);
    assert.deepEqual(
      r.errors.map((e) => [e.file, e.code]),
      [["docket.json", "config"]],
    );
  });
});

describe("git-backed snapshots", () => {
  test("working tree and a ref can disagree", (t) => {
    const repo = makeRepo({ [A]: itemText({ id: A, type: "epic" }) });
    t.after(repo.cleanup);
    repo.commit("add invalid item");
    fs.rmSync(path.join(repo.root, "docs", "items", `${A}.md`));
    const ctx = resolveRepo(repo.root);
    assert.equal(checkSnapshot(workingSnapshot(ctx)).ok, true);
    const head = checkSnapshot(refSnapshot(ctx, "HEAD"));
    assert.equal(head.ok, false);
    assert.ok(hasError(head, "enum", `${A}.md`));
  });

  test("an unknown ref throws DOCKET_BAD_REF", (t) => {
    const repo = makeRepo({ [A]: itemText({ id: A }) });
    t.after(repo.cleanup);
    repo.commit();
    const ctx = resolveRepo(repo.root);
    assert.throws(() => refSnapshot(ctx, "nope"), { code: "DOCKET_BAD_REF" });
  });

  test("a committed docket.json from a newer store version is an error", (t) => {
    const repo = makeRepo({ [A]: itemText({ id: A }) });
    t.after(repo.cleanup);
    fs.writeFileSync(path.join(repo.root, "docket.json"), JSON.stringify({ version: 99 }));
    repo.commit();
    const r = checkSnapshot(refSnapshot(resolveRepo(repo.root), "HEAD"));
    assert.equal(r.ok, false);
    assert.ok(hasError(r, "config-version", "docket.json"));
  });
});

describe("rule 10: item content (Notes)", () => {
  const withBody = (notes) => ({ body: `Facts.\n\n## Notes\n\n${notes}` });
  const good = "### 2026-10-05T14:03:00.000Z · open · owner\n\nQuestion?\n";

  test("a well-formed Notes section passes", () => {
    const r = run([item(A, {}, withBody(good))]);
    assert.deepEqual(r.errors, []);
  });

  test("a malformed Notes header is a rule-10 error naming the file", () => {
    const r = run([item(A, {}, withBody("### nope\n\nx\n"))]);
    assert.equal(r.ok, false);
    assert.ok(
      r.errors.some((e) => e.rule === 10 && e.code === "note-header" && e.file === `${A}.md`),
    );
  });

  test("a repo with one malformed Notes item reports only that item", (t) => {
    const repo = makeRepo({
      [A]: itemText({ id: A }, withBody(good)),
      [B]: itemText({ id: B, rank: "b" }, withBody(`${good}\n${good}`)),
    });
    t.after(repo.cleanup);
    const r = checkSnapshot(workingSnapshot(resolveRepo(repo.root)));
    assert.equal(r.ok, false);
    assert.ok(hasError(r, "note-duplicate", `${B}.md`));
    assert.ok(!r.errors.some((e) => e.file === `${A}.md`));
  });
});
