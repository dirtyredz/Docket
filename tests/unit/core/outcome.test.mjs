import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { planSet } from "../../../src/core/items/set.mjs";
import { mutateStore } from "../../../src/core/items/transaction.mjs";
import { parseEntries } from "../../../src/core/validation/check.mjs";
import { resolveRepo } from "../../../src/repository/context.mjs";
import { workingSnapshot } from "../../../src/repository/snapshot.mjs";
import { itemText, makeRepo } from "../../helpers/repository.mjs";

const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));

const id = (n) => `dk-${String(n).padStart(8, "0")}`;

/** items: {n: [fields, body]}; returns a ctx. */
function setup(items) {
  const texts = {};
  for (const [n, [fields, body]] of Object.entries(items)) {
    texts[id(n)] = itemText({ id: id(n), ...fields }, { body });
  }
  const repo = makeRepo(texts);
  cleanups.push(repo.cleanup);
  return resolveRepo(repo.root);
}

const done = (ctx, n) =>
  mutateStore(ctx, (s) => planSet(s, id(n), { status: "done" }, { today: "2026-11-22" }));
const status = (ctx, n) =>
  parseEntries(workingSnapshot(ctx).entries).find((r) => r.id === id(n)).fields.status;
const refused = (re) => (err) => err.code === "DOCKET_INVALID" && re.test(err.message);

describe("outcome items", () => {
  test("outcome item without Installed-measurement is refused", () => {
    const ctx = setup({ 1: [{}, "Outcome: yes\n"] });
    assert.throws(() => done(ctx, 1), refused(/Installed-measurement/));
    assert.equal(status(ctx, 1), "todo");
  });

  test("blank Installed-measurement is refused", () => {
    const ctx = setup({ 1: [{}, "Outcome: yes\nInstalled-measurement:   \n"] });
    assert.throws(() => done(ctx, 1), refused(/Installed-measurement/));
  });

  test("outcome item with Installed-measurement completes", () => {
    const ctx = setup({
      1: [{}, "Outcome: yes\nInstalled-measurement: install closes in 9 s on v0.10.1\n"],
    });
    done(ctx, 1);
    assert.equal(status(ctx, 1), "done");
  });

  test("markers inside a code fence do not mark an item", () => {
    const ctx = setup({ 1: [{}, "```\nOutcome: yes\n```\n"] });
    done(ctx, 1);
    assert.equal(status(ctx, 1), "done");
  });

  test("items without markers are unaffected, and dropping needs no evidence", () => {
    const ctx = setup({ 1: [{}, "plain\n"], 2: [{}, "Outcome: yes\n"] });
    done(ctx, 1);
    mutateStore(ctx, (s) => planSet(s, id(2), { status: "dropped" }, { today: "2026-11-22" }));
    assert.equal(status(ctx, 2), "dropped");
  });
});

describe("safety switch-off", () => {
  const measured = "Outcome: yes\nInstalled-measurement: ok\n";

  test("follow-up that does not exist is refused", () => {
    const ctx = setup({ 1: [{}, `${measured}Safety-switch-off: ${id(9)}\n`] });
    assert.throws(() => done(ctx, 1), refused(/does not exist/));
  });

  test("a non-id reference is refused", () => {
    const ctx = setup({ 1: [{}, `${measured}Safety-switch-off: later\n`] });
    assert.throws(() => done(ctx, 1), refused(/follow-up item id/));
  });

  test("follow-up without an Owner line is refused", () => {
    const ctx = setup({
      1: [{}, `${measured}Safety-switch-off: ${id(2)}\n`],
      2: [{ status: "done" }, "Turn it back on.\n"],
    });
    assert.throws(() => done(ctx, 1), refused(/no `Owner:`/));
  });

  test("open follow-up blocks completion", () => {
    const ctx = setup({
      1: [{}, `${measured}Safety-switch-off: ${id(2)}\n`],
      2: [{ status: "wip" }, "Owner: lead\n"],
    });
    assert.throws(() => done(ctx, 1), refused(/is wip/));
    assert.equal(status(ctx, 1), "todo");
  });

  test("owned follow-up that is done lets the item complete", () => {
    const ctx = setup({
      1: [{}, `${measured}Safety-switch-off: ${id(2)}\n`],
      2: [{ status: "done" }, "Owner: lead\n"],
    });
    done(ctx, 1);
    assert.equal(status(ctx, 1), "done");
  });

  test("applies to a non-outcome item that records a switch-off", () => {
    const ctx = setup({
      1: [{}, `Safety-switch-off: ${id(2)}\n`],
      2: [{}, "Owner: lead\n"],
    });
    assert.throws(() => done(ctx, 1), refused(/is todo/));
  });
});
