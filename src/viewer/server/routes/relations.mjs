// Relations of one item in one registered checkout:
//   GET /api/repos/:repo/checkouts/:checkout/items/:id/relations
// Forward edges (parent, fixes, blocked_by, relates), reverse edges (children, fixedBy = bugs against
// a feature, blocks, symmetric relates), a summary of every referenced item with an explicit state
// (ok | missing | malformed), and the fresh revisions a relation edit must present.
import { readItem, relationRevisions } from "../../../core/items/detail.mjs";
import * as claims from "../../../state/claims/store.mjs";
import { loadIndex } from "../../../state/index/build.mjs";
import { checkItemId, openScoped } from "../scope.mjs";

const FORWARD = ["fixes", "blocked_by", "relates"];

/** {id: {state, title?, status?, type?, priority?}} for every id in `ids`. */
export function relatedSummaries(records, ids) {
  const out = {};
  for (const id of ids) {
    const r = records.find((x) => x.id === id);
    if (!r) out[id] = { state: "missing" };
    else if (!r.fields || r.errors.length)
      out[id] = { state: "malformed", title: r.title ?? null };
    else {
      const { status, type, priority } = r.fields;
      out[id] = { state: "ok", title: r.title, status, type, priority };
    }
  }
  return out;
}

/** The relations read model for `id` (shared by GET and the response to a relation edit). */
export function relationsOf(ctx, id) {
  const { records } = loadIndex(ctx);
  const { data } = readItem(ctx, id, { records, claims });
  const forward = { parent: data.parent ?? "" };
  for (const k of FORWARD) forward[k] = data[k] ?? [];
  const reverse = data.reverse;
  const ids = new Set([
    ...(forward.parent ? [forward.parent] : []),
    ...FORWARD.flatMap((k) => forward[k]),
    ...Object.values(reverse).flat(),
  ]);
  ids.delete(id);
  // relates stored on the other item: removing it rewrites that item, so its revision is needed.
  const holders = reverse.relates.filter((x) => !forward.relates.includes(x));
  return {
    id,
    type: data.type ?? null,
    revision: data.revision,
    forward,
    reverse,
    reverseStored: holders,
    related: relatedSummaries(records, [...ids].sort()),
    revisions: relationRevisions(ctx, id, holders),
  };
}

export function relationRoutes(deps) {
  return [
    {
      method: "GET",
      path: "/api/repos/:repo/checkouts/:checkout/items/:id/relations",
      handler: ({ params }) => {
        const id = checkItemId(params.id);
        const { ctx } = openScoped(deps, params);
        return relationsOf(ctx, id);
      },
    },
  ];
}
