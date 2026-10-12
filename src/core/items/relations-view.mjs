// The relations read model of one item (a relations panel and the response to a relation edit): forward
// edges, reverse edges, a summary of every referenced item with an explicit state (ok | missing |
// malformed), the reverse-stored `relates` holders and the revision map a relation edit must present
// (linkItem's expectRevisions). Records and claims are arguments, as for readItem, so core stays free of
// the state stores.
import { LIST_KEYS } from "../format/schema.mjs";
import { CODES, docketError } from "../errors.mjs";
import { readItem } from "./detail.mjs";

/** {id: {state, title?, status?, type?, priority?}} for every id in `ids`. */
function relatedSummaries(byId, ids) {
  const out = {};
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) out[id] = { state: "missing" };
    else if (!r.fields || r.errors.length) out[id] = { state: "malformed", title: r.title ?? null };
    else {
      const { status, type, priority } = r.fields;
      out[id] = { state: "ok", title: r.title, status, type, priority };
    }
  }
  return out;
}

/**
 * The relations read model for `id`. options: {records, claims} as readItem, plus optional `detail`: the
 * `data` readItem already returned for `id`, so the relations describe exactly the bytes on display (no
 * second read). Without it, the item is read once here. Returns {id, type, revision, forward: {parent,
 * fixes, blocked_by, relates}, reverse: {children, fixedBy, blocks, relates}, reverseStored, related,
 * revisions}. `revision` and `revisions[id]` are the selected item's revision from that one read;
 * `revisions` also holds each reverse-stored relates holder (an item whose file stores `relates: [id]`,
 * which a removal rewrites) at the revision of the record that showed the edge. It deliberately omits
 * other referenced targets: an edit never rewrites them. A holder record without a revision is omitted,
 * so an edit that would rewrite it is refused (missing entry) rather than written blind.
 */
export function relationsView(ctx, id, { records, claims, detail }) {
  if (detail !== undefined && detail?.id !== id) {
    throw docketError(CODES.USAGE, `detail is not the detail of ${id}`, { id });
  }
  const data = detail ?? readItem(ctx, id, { records, claims }).data;
  const byId = new Map(records.filter((r) => r.id !== id).map((r) => [r.id, r]));
  const forward = { parent: data.parent ?? "" };
  for (const k of LIST_KEYS) forward[k] = data[k] ?? [];
  const reverse = data.reverse;
  const ids = new Set([
    ...(forward.parent ? [forward.parent] : []),
    ...LIST_KEYS.flatMap((k) => forward[k]),
    ...Object.values(reverse).flat(),
  ]);
  ids.delete(id);
  // relates stored on the other item: removing it rewrites that item, so its revision is needed.
  const holders = reverse.relates.filter((x) => !forward.relates.includes(x));
  const revisions = { [id]: data.revision };
  for (const h of holders) {
    const revision = byId.get(h)?.revision;
    if (revision) revisions[h] = revision;
  }
  return {
    id,
    type: data.type ?? null,
    revision: data.revision,
    forward,
    reverse,
    reverseStored: holders,
    related: relatedSummaries(byId, [...ids].sort()),
    revisions,
  };
}
