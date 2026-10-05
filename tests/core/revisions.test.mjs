// Revision preconditions are asserted inside the mutation lock before planning, for changes and
// no-ops alike, and (when supplied) for every reverse-stored relation holder a link edit rewrites.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { localDate } from "../../src/core/identity/date.mjs";
import { setItem } from "../../src/core/items/complete.mjs";
import { planLink } from "../../src/core/items/link.mjs";
import { mutateStore } from "../../src/core/items/transaction.mjs";
import { resolveRepo } from "../../src/repository/context.mjs";
import { readItemFile } from "../../src/storage/item-store.mjs";
import { itemText, makeRepo, readItem } from "../helpers/repository.mjs";

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
        { relates: [B], remove: true },
        { expect: expected[A], expectRevisions: expected },
      ),
    { code: "DOCKET_CONFLICT" },
  );
  assert.equal(readItem(r.root, A), beforeA);
  assert.match(readItem(r.root, B), /relates: \[dk-0000a001\]/);
});

test("a missing holder revision is a request error when revisions are supplied", () => {
  const { ctx } = setup();
  assert.throws(
    () =>
      link(
        ctx,
        A,
        { relates: [B], remove: true },
        { expect: rev(ctx, A), expectRevisions: { [A]: rev(ctx, A) } },
      ),
    { code: "DOCKET_USAGE" },
  );
});

test("current holder revisions remove the reverse-stored relation", () => {
  const { r, ctx } = setup();
  const expected = { [A]: rev(ctx, A), [B]: rev(ctx, B) };
  const { value } = link(
    ctx,
    A,
    { relates: [B], remove: true },
    { expect: expected[A], expectRevisions: expected },
  );
  assert.deepEqual(value.changes, [{ op: "remove", key: "relates", target: B, storedOn: B }]);
  assert.match(readItem(r.root, B), /relates: \[\]/);
});
