// Revision preconditions are asserted inside the mutation lock before planning, for changes and
// no-ops alike.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { localDate } from "../../../src/core/identity/date.mjs";
import { setItem } from "../../../src/core/items/complete.mjs";
import { planLink } from "../../../src/core/items/link.mjs";
import { mutateStore } from "../../../src/core/items/transaction.mjs";
import { resolveRepo } from "../../../src/repository/context.mjs";
import { readItemFile } from "../../../src/storage/item-store.mjs";
import { itemText, makeRepo, readItem } from "../../helpers/repository.mjs";

const A = "dk-0000a001";
const B = "dk-0000b002";
const STALE = "0000000000000000";
const noClaims = { releaseItem: () => ({ released: false }) };
const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

function setup() {
  const r = makeRepo({
    [A]: itemText({ id: A }, { title: "A" }),
    [B]: itemText({ id: B, rank: "b", relates: [A] }, { title: "B" }),
  });
  repos.push(r);
  return { r, ctx: resolveRepo(r.root) };
}
const rev = (ctx, id) => readItemFile(ctx, id).revision;
const link = (ctx, id, change, options) =>
  mutateStore(ctx, (s) => planLink(s, id, change, options));

test("a stale expected revision fails a no-op set", () => {
  const { ctx } = setup();
  assert.throws(
    () =>
      setItem(ctx, A, { status: "todo" }, { today: localDate(), expect: STALE, claims: noClaims }),
    { code: "DOCKET_CONFLICT" },
  );
});

test("a current expected revision still allows a no-op set", () => {
  const { ctx } = setup();
  const { data } = setItem(
    ctx,
    A,
    { status: "todo" },
    { today: localDate(), expect: rev(ctx, A), claims: noClaims },
  );
  assert.equal(data.noop, true);
});

test("a stale expected revision fails a no-op link", () => {
  const { ctx } = setup();
  assert.throws(() => link(ctx, A, { relates: [B] }, { expect: STALE }), {
    code: "DOCKET_CONFLICT",
  });
});

test("a current expected revision removes the reverse-stored relation", () => {
  const { r, ctx } = setup();
  const { value } = link(ctx, A, { relates: [B], remove: true }, { expect: rev(ctx, A) });
  assert.deepEqual(value.changes, [{ op: "remove", key: "relates", target: B, storedOn: B }]);
  assert.match(readItem(r.root, B), /relates: \[\]/);
});

// --- Revision maps (expectRevisions): the selected item plus every other file the edit rewrites ---

test("without a map the CLI behaviour stands: holders are written at their current revision", () => {
  const { r, ctx } = setup();
  r.write(B, itemText({ id: B, rank: "b", relates: [A] }, { title: "B edited elsewhere" }));
  const { written } = link(ctx, A, { relates: [B], remove: true }, { expect: rev(ctx, A) });
  assert.deepEqual(
    written.map((w) => w.id),
    [B],
  );
});

test("a changed reverse-stored relation holder fails before any write", () => {
  const { r, ctx } = setup();
  const expected = { [A]: rev(ctx, A), [B]: rev(ctx, B) };
  r.write(B, itemText({ id: B, rank: "b", relates: [A] }, { title: "B edited elsewhere" }));
  const beforeA = readItem(r.root, A);
  assert.throws(
    () =>
      link(
        ctx,
        A,
        { relates: [B], remove: true, fixes: [] },
        { expect: expected[A], expectRevisions: expected },
      ),
    (err) => err.code === "DOCKET_CONFLICT" && err.details.id === B,
  );
  assert.equal(readItem(r.root, A), beforeA);
  assert.match(readItem(r.root, B), /relates: \[dk-0000a001\]/);
});

test("a missing holder entry is a request error, and nothing is written", () => {
  const { r, ctx } = setup();
  const beforeB = readItem(r.root, B);
  assert.throws(
    () => link(ctx, A, { relates: [B], remove: true }, { expectRevisions: { [A]: rev(ctx, A) } }),
    (err) => err.code === "DOCKET_USAGE" && err.details.id === B,
  );
  assert.equal(readItem(r.root, B), beforeB);
});

test("the selected item must be in the map, and expect must agree with it", () => {
  const { ctx } = setup();
  assert.throws(
    () => link(ctx, A, { relates: [B] }, { expectRevisions: { [B]: rev(ctx, B) } }),
    (err) => err.code === "DOCKET_USAGE" && err.details.id === A,
  );
  assert.throws(
    () =>
      link(
        ctx,
        A,
        { relates: [B] },
        { expect: STALE, expectRevisions: { [A]: rev(ctx, A), [B]: rev(ctx, B) } },
      ),
    { code: "DOCKET_USAGE", message: /disagree/ },
  );
  for (const bad of [[], "x", { [A]: "" }, { [A]: 7 }]) {
    assert.throws(() => link(ctx, A, { relates: [B] }, { expectRevisions: bad }), {
      code: "DOCKET_USAGE",
    });
  }
});

test("a stale selected entry fails even when the edit is a no-op", () => {
  const { ctx } = setup();
  // A relates B is already stored on B: adding it again changes nothing.
  assert.throws(
    () => link(ctx, A, { relates: [B] }, { expectRevisions: { [A]: STALE, [B]: rev(ctx, B) } }),
    { code: "DOCKET_CONFLICT" },
  );
  const { written } = link(
    ctx,
    A,
    { relates: [B] },
    { expectRevisions: { [A]: rev(ctx, A), [B]: rev(ctx, B) } },
  );
  assert.deepEqual(written, []);
});

test("entries for items the edit does not rewrite are not checked", () => {
  const { r, ctx } = setup();
  const map = { [A]: rev(ctx, A), [B]: STALE };
  // Adding a parent rewrites only A: B's stale entry is irrelevant to this edit.
  const { written } = link(ctx, A, { parent: B }, { expectRevisions: map });
  assert.deepEqual(
    written.map((w) => w.id),
    [A],
  );
  assert.match(readItem(r.root, A), /parent: dk-0000b002/);
});
