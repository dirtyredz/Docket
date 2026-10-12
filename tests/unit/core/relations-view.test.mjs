// relationsView (the relations read model): forward and reverse edges, referenced-item states, the
// reverse-stored relates holders, and a revision map that covers exactly the selected item (at the
// revision of the bytes on display) and the holders an edit may rewrite.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readItem } from "../../../src/core/items/detail.mjs";
import { linkItem } from "../../../src/core/items/link.mjs";
import { relationsView } from "../../../src/core/items/relations-view.mjs";
import { resolveRepo } from "../../../src/repository/context.mjs";
import { loadIndex } from "../../../src/state/index/build.mjs";
import { itemText, makeRepo } from "../../helpers/repository.mjs";

const A = "dk-0000a001";
const B = "dk-0000b002";
const C = "dk-0000c003";
const D = "dk-0000d004";
const noClaims = { readClaims: () => ({ claims: {} }) };
const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

function setup() {
  const r = makeRepo({
    [A]: itemText({ id: A, rank: "a", type: "feature", relates: [D] }, { title: "A" }),
    [B]: itemText({ id: B, rank: "b", parent: A, relates: [A] }, { title: "B" }),
    [C]: itemText({ id: C, rank: "c", fixes: [A] }, { title: "C" }),
    [D]: itemText({ id: D, rank: "d" }, { title: "D" }),
  });
  repos.push(r);
  return { r, ctx: resolveRepo(r.root) };
}

const records = (ctx) => loadIndex(ctx).records;
const view = (ctx, id, extra = {}) =>
  relationsView(ctx, id, { records: records(ctx), claims: noClaims, ...extra });

test("forward and reverse edges, summaries and the reverse-stored relates holders", () => {
  const { ctx } = setup();
  const v = view(ctx, A);
  assert.equal(v.type, "feature");
  assert.deepEqual(v.forward, { parent: "", fixes: [], blocked_by: [], relates: [D] });
  assert.deepEqual(v.reverse.children, [B]);
  assert.deepEqual(v.reverse.fixedBy, [C]);
  assert.deepEqual(v.reverse.relates, [B, D]);
  assert.deepEqual(v.reverseStored, [B]);
  assert.deepEqual(v.related[B], {
    state: "ok",
    title: "B",
    status: "todo",
    type: "task",
    priority: "P2",
  });
  assert.deepEqual(Object.keys(v.related).sort(), [B, C, D]);
});

test("the revision map holds the selected item and reverse-stored holders only", () => {
  const { ctx } = setup();
  const v = view(ctx, A);
  const byId = new Map(records(ctx).map((r) => [r.id, r]));
  // D is referenced but stored on A; C and B's parent edge are stored on them but never rewritten by
  // an edit of A's relations: none of them belongs in the map.
  assert.deepEqual(v.revisions, { [A]: v.revision, [B]: byId.get(B).revision });
  assert.equal(v.revision, byId.get(A).revision);
});

test("missing and malformed targets carry an explicit state", () => {
  const { r, ctx } = setup();
  r.write(C, itemText({ id: C, rank: "c", fixes: [A], blocked_by: ["dk-0000dead"] }, {}));
  r.write(D, "---\nnot an item\n");
  const v = view(ctx, C);
  assert.deepEqual(v.forward.fixes, [A]);
  assert.deepEqual(v.forward.blocked_by, ["dk-0000dead"]);
  assert.deepEqual(v.related["dk-0000dead"], { state: "missing" });
  assert.deepEqual(v.reverseStored, []);
  assert.equal(view(ctx, A).related[D].state, "malformed");
});

test("given the displayed detail, the view describes those bytes, not a later read", () => {
  const { r, ctx } = setup();
  const shown = readItem(ctx, A, { records: records(ctx), claims: noClaims }).data;
  // An external save lands between the detail read and the relations read.
  r.write(A, itemText({ id: A, rank: "a", type: "feature", relates: [D] }, { title: "A edited" }));
  const v = view(ctx, A, { detail: shown });
  assert.equal(v.revision, shown.revision);
  assert.equal(v.revisions[A], shown.revision);
  // So an edit made from that screen is refused instead of applied to bytes the owner never saw.
  assert.throws(
    () => linkItem(ctx, A, { relates: [B], remove: true }, { expectRevisions: v.revisions }),
    { code: "DOCKET_CONFLICT" },
  );
  // Without a detail, the selected revision comes from the view's own single read.
  const fresh = view(ctx, A);
  assert.notEqual(fresh.revision, shown.revision);
  assert.equal(fresh.revisions[A], fresh.revision);
});

test("a detail of another item is a request error", () => {
  const { ctx } = setup();
  const other = readItem(ctx, B, { records: records(ctx), claims: noClaims }).data;
  assert.throws(() => view(ctx, A, { detail: other }), { code: "DOCKET_USAGE" });
});

test("the map from a view drives a reverse-stored removal end to end", () => {
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
  const after = view(ctx, A);
  assert.deepEqual(after.reverseStored, []);
  assert.deepEqual(Object.keys(after.revisions), [A]);
});
