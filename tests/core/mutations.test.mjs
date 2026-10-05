import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { localDate } from "../../src/core/identity/date.mjs";
import { planAdd } from "../../src/core/items/add.mjs";
import { planAddBatch } from "../../src/core/items/batch.mjs";
import { planLink } from "../../src/core/items/link.mjs";
import {
  compareItems,
  isBlocked,
  listItems,
  reverseRelations,
} from "../../src/core/items/query.mjs";
import { planSet } from "../../src/core/items/set.mjs";
import { mutateStore } from "../../src/core/items/transaction.mjs";
import { parseEntries } from "../../src/core/validation/check.mjs";
import { resolveRepo } from "../../src/repository/context.mjs";
import { workingSnapshot } from "../../src/repository/snapshot.mjs";
import { localTime, scriptedRandom } from "../helpers/clock.mjs";
import { itemText, makeRepo, readItem } from "../helpers/repository.mjs";

const TODAY = "2026-10-04";
const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));

const id = (n) => `dk-${String(n).padStart(8, "0")}`;

/** Disposable repo with items {id: fields-or-[fields, opts]}; returns {root, ctx, write}. */
function setup(items = {}) {
  const texts = {};
  for (const [k, v] of Object.entries(items)) {
    const [fields, opts] = Array.isArray(v) ? v : [v];
    texts[k] = itemText({ id: k, ...fields }, opts);
  }
  const repo = makeRepo(texts);
  cleanups.push(repo.cleanup);
  return { root: repo.root, ctx: resolveRepo(repo.root), write: repo.write };
}

const records = (ctx) => parseEntries(workingSnapshot(ctx).entries);
const order = (ctx) => listItems(records(ctx), { all: true }).items.map((i) => i.id);
const code = (c) => (err) => err.code === c;
const fieldsOf = (ctx, target) => records(ctx).find((r) => r.id === target).fields;

const add = (ctx, input, random) =>
  mutateStore(ctx, (s) => planAdd(s, input, { today: TODAY, random }));
const set = (ctx, target, changes, opts = {}) =>
  mutateStore(ctx, (s) => planSet(s, target, changes, { today: TODAY, ...opts }));
const link = (ctx, target, change, opts = {}) =>
  mutateStore(ctx, (s) => planLink(s, target, change, opts));
const task = { type: "task", priority: "P2", title: "x" };

describe("planAdd", () => {
  test("is date-free: created/since inputs are ignored, always today", () => {
    const { ctx } = setup();
    const { value } = add(ctx, { ...task, created: "2020-01-01", since: "2021-02-02" });
    const f = fieldsOf(ctx, value.id);
    assert.equal(f.created, TODAY);
    assert.equal(f.since, TODAY);
  });

  test("mints dk id, defaults, dates, title and body", () => {
    const { ctx, root } = setup();
    const { value, written } = add(ctx, {
      ...task,
      type: "bug",
      title: "Fix it",
      body: "Details\n",
    });
    assert.match(value.id, /^dk-[0-9a-f]{8}$/);
    assert.equal(written.length, 1);
    const f = fieldsOf(ctx, value.id);
    assert.equal(f.created, TODAY);
    assert.equal(f.since, TODAY);
    assert.equal(f.status, "todo");
    assert.equal(f.area, "");
    assert.equal(f.parent, "");
    assert.deepEqual([f.fixes, f.blocked_by, f.relates], [[], [], []]);
    const text = readItem(root, value.id);
    assert.match(text, /\n# Fix it\n/);
    assert.match(text, /Details\n$/);
  });

  test("rank goes to the end of its own priority band", () => {
    const { ctx } = setup({
      [id(1)]: { priority: "P1", rank: "m" },
      [id(2)]: { priority: "P1", rank: "t" },
      [id(3)]: { priority: "P2", rank: "c" },
    });
    const p1 = add(ctx, { ...task, priority: "P1" }).value.fields.rank;
    assert.ok(p1 > "t");
    const p3 = add(ctx, { ...task, priority: "P3" }).value.fields.rank;
    assert.match(p3, /^[a-z]+$/);
    const p2 = add(ctx, task).value.fields.rank;
    assert.ok(p2 > "c" && p2 < p1);
  });

  test("retries a colliding id", () => {
    const { ctx } = setup({ [id(1)]: {} });
    const { value } = add(ctx, task, scriptedRandom("00000001", "0000abcd"));
    assert.equal(value.id, "dk-0000abcd");
  });

  test("a malformed existing file still reserves its id", () => {
    const { ctx, write } = setup();
    write(id(1), "garbage, not an item\n");
    const { value } = add(ctx, task, scriptedRandom("00000001", "0000abcd"));
    assert.equal(value.id, "dk-0000abcd");
  });

  test("exhausted ids raise DOCKET_ID_EXHAUSTED", () => {
    const { ctx } = setup({ [id(1)]: {} });
    assert.throws(() => add(ctx, task, scriptedRandom("00000001")), code("DOCKET_ID_EXHAUSTED"));
  });

  test("invalid input raises DOCKET_INVALID", () => {
    const { ctx } = setup();
    const bads = [
      { type: "epic" },
      { priority: "P9" },
      { title: "" },
      { title: "   " },
      { title: "two\nlines" },
    ];
    for (const bad of bads) {
      assert.throws(
        () => add(ctx, { ...task, ...bad }),
        code("DOCKET_INVALID"),
        JSON.stringify(bad),
      );
    }
    assert.equal(records(ctx).length, 0);
  });
});

describe("planSet", () => {
  test("id and created never change; real status change sets since", () => {
    const { ctx } = setup({ [id(1)]: { created: "2026-01-01", since: "2026-02-02" } });
    const { value } = set(ctx, id(1), { status: "wip" });
    const f = fieldsOf(ctx, id(1));
    assert.equal(f.id, id(1));
    assert.equal(f.created, "2026-01-01");
    assert.equal(f.status, "wip");
    assert.equal(f.since, TODAY);
    assert.ok(value.changed.includes("status"));
  });

  test("same status again writes nothing", () => {
    const { ctx, root } = setup({ [id(1)]: { status: "wip", since: "2026-02-02" } });
    const before = readItem(root, id(1));
    const { value, written } = set(ctx, id(1), { status: "wip" });
    assert.deepEqual(written, []);
    assert.deepEqual(value.changed, []);
    assert.equal(readItem(root, id(1)), before);
  });

  test("area and type edits leave since alone", () => {
    const { ctx } = setup({ [id(1)]: { since: "2026-02-02" } });
    set(ctx, id(1), { area: "ui", type: "bug" });
    const f = fieldsOf(ctx, id(1));
    assert.equal(f.area, "ui");
    assert.equal(f.type, "bug");
    assert.equal(f.since, "2026-02-02");
  });

  test("priority change lands at the end of the destination band", () => {
    const { ctx } = setup({
      [id(1)]: { priority: "P2", rank: "c" },
      [id(2)]: { priority: "P0", rank: "m" },
      [id(3)]: { priority: "P0", rank: "x" },
    });
    set(ctx, id(1), { priority: "P0" });
    const f = fieldsOf(ctx, id(1));
    assert.equal(f.priority, "P0");
    assert.ok(f.rank > "x");
    assert.deepEqual(order(ctx), [id(2), id(3), id(1)]);
  });

  describe("placement", () => {
    const three = () =>
      setup({ [id(1)]: { rank: "e" }, [id(2)]: { rank: "n" }, [id(3)]: { rank: "t" } });

    test("before, after, top, bottom order correctly", () => {
      const { ctx } = three();
      set(ctx, id(3), { placement: { before: id(1) } });
      assert.deepEqual(order(ctx), [id(3), id(1), id(2)]);
      set(ctx, id(3), { placement: { after: id(1) } });
      assert.deepEqual(order(ctx), [id(1), id(3), id(2)]);
      set(ctx, id(2), { placement: { top: true } });
      assert.deepEqual(order(ctx), [id(2), id(1), id(3)]);
      set(ctx, id(2), { placement: { bottom: true } });
      assert.deepEqual(order(ctx), [id(1), id(3), id(2)]);
      const sorted = records(ctx)
        .sort(compareItems)
        .map((r) => r.id);
      assert.deepEqual(sorted, order(ctx));
    });

    test("a reorder changes exactly one file", () => {
      const { ctx, root } = three();
      const snap = [1, 2, 3].map((n) => readItem(root, id(n)));
      const { written } = set(ctx, id(3), { placement: { before: id(1) } });
      assert.deepEqual(
        written.map((w) => w.id),
        [id(3)],
      );
      assert.equal(readItem(root, id(1)), snap[0]);
      assert.equal(readItem(root, id(2)), snap[1]);
      assert.notEqual(readItem(root, id(3)), snap[2]);
    });

    test("anchor in another priority adopts that priority", () => {
      const { ctx } = setup({
        [id(1)]: { priority: "P3", rank: "n" },
        [id(2)]: { priority: "P1", rank: "n" },
      });
      set(ctx, id(1), { placement: { after: id(2) } });
      assert.equal(fieldsOf(ctx, id(1)).priority, "P1");
      assert.deepEqual(order(ctx), [id(2), id(1)]);
    });

    test("relative to itself is DOCKET_USAGE", () => {
      const { ctx } = three();
      assert.throws(() => set(ctx, id(1), { placement: { before: id(1) } }), code("DOCKET_USAGE"));
    });
  });

  test("value.completed for done and dropped only", () => {
    const { ctx } = setup({ [id(1)]: {}, [id(2)]: {}, [id(3)]: {} });
    assert.equal(set(ctx, id(1), { status: "done" }).value.completed, true);
    assert.equal(set(ctx, id(2), { status: "dropped" }).value.completed, true);
    assert.equal(set(ctx, id(3), { status: "wip" }).value.completed, false);
  });

  test("local date rollover", () => {
    assert.equal(localDate(localTime(2026, 10, 4, 23, 59)), "2026-10-04");
    assert.equal(localDate(localTime(2026, 10, 5, 0, 0)), "2026-10-05");
    const { ctx } = setup({ [id(1)]: {} });
    const today = localDate(localTime(2026, 10, 5, 0, 0));
    mutateStore(ctx, (s) => planSet(s, id(1), { status: "wip" }, { today }));
    assert.equal(fieldsOf(ctx, id(1)).since, "2026-10-05");
  });

  test("body bytes survive a set", () => {
    const body = "Café ☃ \u{1F600}\n\ttabbed line\ntrailing spaces   \n\n  indented\n";
    const { ctx, root } = setup({ [id(1)]: [{}, { title: "Títle", body }] });
    set(ctx, id(1), { status: "wip", area: "x" });
    assert.ok(readItem(root, id(1)).endsWith(`# Títle\n\n${body}`));
  });

  test("wrong expect is DOCKET_CONFLICT and the file is unchanged", () => {
    const { ctx, root } = setup({ [id(1)]: {} });
    const before = readItem(root, id(1));
    assert.throws(
      () => set(ctx, id(1), { status: "wip" }, { expect: "deadbeefdeadbeef" }),
      code("DOCKET_CONFLICT"),
    );
    assert.equal(readItem(root, id(1)), before);
  });

  test("a change that introduces an error is rejected untouched", () => {
    const { ctx, root } = setup({ [id(1)]: { created: "2026-01-01" } });
    const before = readItem(root, id(1));
    assert.throws(
      () => mutateStore(ctx, (s) => planSet(s, id(1), { status: "done" }, { today: "2025-12-31" })),
      code("DOCKET_INVALID"),
    );
    assert.equal(readItem(root, id(1)), before);
  });

  test("blocked_by cycle via link is rejected untouched", () => {
    const { ctx, root } = setup({ [id(1)]: { blocked_by: [id(2)] }, [id(2)]: {} });
    const before = readItem(root, id(2));
    assert.throws(() => link(ctx, id(2), { blocked_by: [id(1)] }), code("DOCKET_INVALID"));
    assert.equal(readItem(root, id(2)), before);
  });

  test("unrelated existing errors do not block a valid edit", () => {
    const { ctx, root } = setup({ [id(1)]: {}, [id(9)]: { status: "bogus" } });
    const broken = readItem(root, id(9));
    set(ctx, id(1), { status: "wip" });
    assert.equal(fieldsOf(ctx, id(1)).status, "wip");
    assert.equal(readItem(root, id(9)), broken);
  });
});

describe("planLink", () => {
  const trio = () => setup({ [id(1)]: { type: "bug" }, [id(2)]: {}, [id(3)]: {} });

  test("set, clear and remove parent", () => {
    const { ctx } = trio();
    link(ctx, id(1), { parent: id(2) });
    assert.equal(fieldsOf(ctx, id(1)).parent, id(2));
    link(ctx, id(1), { clearParent: true });
    assert.equal(fieldsOf(ctx, id(1)).parent, "");
    link(ctx, id(1), { parent: id(3) });
    link(ctx, id(1), { parent: id(3), remove: true });
    assert.equal(fieldsOf(ctx, id(1)).parent, "");
  });

  test("add and remove list members; duplicate add is a no-op", () => {
    const { ctx } = trio();
    link(ctx, id(1), { fixes: [id(2)], blocked_by: [id(3)] });
    const f = fieldsOf(ctx, id(1));
    assert.deepEqual([f.fixes, f.blocked_by], [[id(2)], [id(3)]]);
    assert.deepEqual(link(ctx, id(1), { fixes: [id(2)] }).written, []);
    link(ctx, id(1), { fixes: [id(2)], remove: true });
    assert.deepEqual(fieldsOf(ctx, id(1)).fixes, []);
  });

  test("relates is symmetric: reverse add is a no-op, reverse remove edits the holder", () => {
    const { ctx } = trio();
    link(ctx, id(1), { relates: [id(2)] });
    assert.deepEqual(link(ctx, id(2), { relates: [id(1)] }).written, []);
    assert.deepEqual(fieldsOf(ctx, id(2)).relates, []);
    const { value, written } = link(ctx, id(2), { relates: [id(1)], remove: true });
    assert.equal(value.changes[0].storedOn, id(1));
    assert.deepEqual(
      written.map((w) => w.id),
      [id(1)],
    );
    assert.deepEqual(fieldsOf(ctx, id(1)).relates, []);
  });

  test("reverseRelations reports children, fixedBy, blocks and symmetric relates", () => {
    const { ctx } = setup({
      [id(1)]: {},
      [id(2)]: { parent: id(1) },
      [id(3)]: { type: "bug", fixes: [id(1)] },
      [id(4)]: { blocked_by: [id(1)] },
      [id(5)]: { relates: [id(1)] },
      [id(6)]: {},
    });
    link(ctx, id(1), { relates: [id(6)] });
    const rev = reverseRelations(records(ctx), id(1));
    assert.deepEqual(rev.children, [id(2)]);
    assert.deepEqual(rev.fixedBy, [id(3)]);
    assert.deepEqual(rev.blocks, [id(4)]);
    assert.deepEqual(rev.relates, [id(5), id(6)]);
    assert.deepEqual(reverseRelations(records(ctx), id(6)).relates, [id(1)]);
  });

  test("dangling target is DOCKET_INVALID", () => {
    const { ctx, root } = trio();
    const before = readItem(root, id(1));
    for (const change of [{ parent: id(7) }, { blocked_by: [id(7)] }, { relates: [id(7)] }]) {
      assert.throws(() => link(ctx, id(1), change), code("DOCKET_INVALID"));
    }
    assert.equal(readItem(root, id(1)), before);
  });
});

describe("isBlocked", () => {
  test("blocked while any blocked_by target is open", () => {
    const status = { a: "done", b: "dropped", c: "wip", d: "todo" };
    const statusOf = (t) => status[t];
    assert.equal(isBlocked({ blocked_by: [] }, statusOf), false);
    assert.equal(isBlocked({ blocked_by: ["a", "b"] }, statusOf), false);
    assert.equal(isBlocked({ blocked_by: ["a", "c"] }, statusOf), true);
    assert.equal(isBlocked({ blocked_by: ["d"] }, statusOf), true);
  });
});

describe("field-named add errors", () => {
  const ctx = { today: TODAY };
  const store = { records: [] };
  const bad = (input) =>
    planAdd(store, { type: "task", priority: "P2", title: "t", ...input }, ctx);

  test("core names the field, not a CLI flag", () => {
    assert.throws(
      () => bad({ type: "nope" }),
      (e) => e.message.startsWith("type must be one of"),
    );
    assert.throws(
      () => bad({ priority: "P9" }),
      (e) => e.message.startsWith("priority must be one of"),
    );
    assert.throws(
      () => bad({ status: "x" }),
      (e) => e.message.startsWith("status must be one of"),
    );
    assert.throws(
      () => bad({ title: "a\nb" }),
      (e) => e.message === "title must be one non-empty line",
    );
  });

  test("batch prefixes the entry index only", () => {
    assert.throws(
      () =>
        planAddBatch(
          store,
          [
            { type: "task", priority: "P2", title: "ok" },
            { type: "zz", priority: "P2", title: "t" },
          ],
          ctx,
        ),
      (e) => e.message.startsWith("batch[1]: type must be one of"),
    );
  });
});

describe("Notes survive other mutations", () => {
  const NOTES_BODY =
    "Facts.\n\n## Notes\n\n### 2026-10-05T14:03:00.000Z · open · owner\n\nQuestion?\n\n" +
    "### 2026-10-05T14:04:00.000Z · resolved · agent\n\n\tTabbed  \n";
  const withNotes = () => {
    const env = setup({ [id(1)]: [{}, { title: "T", body: NOTES_BODY }], [id(2)]: {} });
    const suffix = (text) => text.slice(text.indexOf("\n## Notes"));
    return { ...env, suffix, before: readItem(env.root, id(1)) };
  };

  test("set status and priority keep the Notes section byte for byte", () => {
    const { ctx, root, suffix, before } = withNotes();
    set(ctx, id(1), { status: "wip", priority: "P1" });
    const after = readItem(root, id(1));
    assert.notEqual(after, before);
    assert.equal(suffix(after), suffix(before));
    assert.equal(after.slice(after.indexOf("# T\n")), before.slice(before.indexOf("# T\n")));
  });

  test("set title rewrites only the H1", () => {
    const { ctx, root, before } = withNotes();
    set(ctx, id(1), { title: "Renamed" });
    assert.equal(readItem(root, id(1)), before.replace("# T\n", "# Renamed\n"));
  });

  test("link keeps the Notes section byte for byte", () => {
    const { ctx, root, suffix, before } = withNotes();
    link(ctx, id(1), { relates: [id(2)], parent: id(2) });
    const after = readItem(root, id(1));
    assert.notEqual(after, before);
    assert.equal(suffix(after), suffix(before));
    link(ctx, id(1), { relates: [id(2)], remove: true });
    assert.equal(suffix(readItem(root, id(1))), suffix(before));
  });
});
