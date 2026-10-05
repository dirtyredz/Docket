// The relations read model of one item (the viewer's relations panel and the response to a relation
// edit): forward edges, reverse edges, a summary of every referenced item with an explicit state
// (ok | missing | malformed), the reverse-stored `relates` holders and the fresh revisions an edit must
// present. Records and claims are arguments, as for readItem, so core stays free of the state stores.
import { readItem, relationRevisions } from "./detail.mjs";

const FORWARD = ["fixes", "blocked_by", "relates"];

/** {id: {state, title?, status?, type?, priority?}} for every id in `ids`. */
function relatedSummaries(records, ids) {
  const out = {};
  for (const id of ids) {
    const r = records.find((x) => x.id === id);
    if (!r) out[id] = { state: "missing" };
    else if (!r.fields || r.errors.length) out[id] = { state: "malformed", title: r.title ?? null };
    else {
      const { status, type, priority } = r.fields;
      out[id] = { state: "ok", title: r.title, status, type, priority };
    }
  }
  return out;
}

/** The relations read model for `id`. options as readItem: {records, claims}. */
export function relationsView(ctx, id, { records, claims }) {
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
