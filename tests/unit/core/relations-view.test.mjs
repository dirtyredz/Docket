// relationsView (the relations read model) and linkItem / withWritten (the link operation's result shape).
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { linkItem } from "../../../src/core/items/link.mjs";
import { relationsView } from "../../../src/core/items/relations-view.mjs";
import { withWritten } from "../../../src/core/items/transaction.mjs";
import { resolveRepo } from "../../../src/repository/context.mjs";
import { loadIndex } from "../../../src/state/index/build.mjs";
import { itemText, makeRepo } from "../../helpers/repository.mjs";

const A = "dk-0000a001";
const B = "dk-0000b002";
const C = "dk-0000c003";
const noClaims = { readClaims: () => ({ claims: {} }) };
const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

function setup() {
  const r = makeRepo({
    [A]: itemText({ id: A, rank: "a", type: "feature" }, { title: "A" }),
    [B]: itemText({ id: B, rank: "b", parent: A, relates: [A] }, { title: "B" }),
    [C]: itemText({ id: C, rank: "c", fixes: [A] }, { title: "C" }),
  });
  repos.push(r);
  return { r, ctx: resolveRepo(r.root) };
}

const view = (ctx, id) =>
  relationsView(ctx, id, { records: loadIndex(ctx).records, claims: noClaims });

test("relationsView lists reverse edges, summaries and the reverse-stored relates holders", () => {
  const { ctx } = setup();
  const v = view(ctx, A);
  assert.deepEqual(v.reverse.children, [B]);
  assert.deepEqual(v.reverse.relates, [B]);
  assert.deepEqual(v.reverseStored, [B]);
  assert.equal(v.related[B].state, "ok");
  assert.equal(v.related[B].title, "B");
  assert.deepEqual(Object.keys(v.revisions).sort(), [A, B]);
  assert.equal(v.revisions[A], v.revision);
});

test("relationsView marks a missing target and keeps forward edges", () => {
  const { r, ctx } = setup();
  r.write(
    C,
    itemText({ id: C, rank: "c", fixes: [A], blocked_by: ["dk-0000dead"] }, { title: "C" }),
  );
  const v = view(ctx, C);
  assert.deepEqual(v.forward.fixes, [A]);
  assert.deepEqual(v.forward.blocked_by, ["dk-0000dead"]);
  assert.deepEqual(v.related["dk-0000dead"], { state: "missing" });
  assert.deepEqual(v.reverseStored, []);
});

test("linkItem returns the changes and every written revision", () => {
  const { ctx } = setup();
  const before = view(ctx, A);
  const out = linkItem(
    ctx,
    A,
    { relates: [B], remove: true },
    { expect: before.revision, expectRevisions: before.revisions },
  );
  assert.deepEqual(out.changes, [{ op: "remove", key: "relates", target: B, storedOn: B }]);
  assert.deepEqual(
    out.written.map((w) => w.id),
    [B],
  );
  assert.equal("noop" in out, false);
  assert.deepEqual(view(ctx, A).reverseStored, []);
});

test("withWritten derives revision and noop, or exactly the keys asked for", () => {
  const value = { id: A, revision: "kept" };
  assert.deepEqual(withWritten({ value, written: [] }), { id: A, revision: "kept", noop: true });
  const written = [{ id: A, revision: "new" }];
  assert.deepEqual(withWritten({ value, written }), { id: A, revision: "new", noop: false });
  assert.deepEqual(withWritten({ value: { id: A }, written: [] }, ["written"]), {
    id: A,
    written: [],
  });
});
