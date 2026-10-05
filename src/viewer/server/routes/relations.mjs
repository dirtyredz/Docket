// Relations of one item in one registered checkout:
//   GET  /api/repos/:repo/checkouts/:checkout/items/:id/relations
//   POST /api/repos/:repo/checkouts/:checkout/items/:id/relations  one edge:
//        {action: add | remove, key: parent | fixes | blocked_by | relates, target, expected: {id: rev}}
// Forward edges (parent, fixes, blocked_by, relates), reverse edges (children, fixedBy = bugs against
// a feature, blocks, symmetric relates), a summary of every referenced item with an explicit state
// (ok | missing | malformed), and the fresh revisions a relation edit must present. An edit runs core
// planLink inside mutateStore exactly as `docket link` does, with every rewritten file's revision
// required up front (reverse-stored relates included), so a stale edit is a 409 before any write.
import { ID_RE, RELATION_KEYS } from "../../../core/format/schema.mjs";
import { readItem, relationRevisions } from "../../../core/items/detail.mjs";
import { planLink } from "../../../core/items/link.mjs";
import { mutateStore } from "../../../core/items/transaction.mjs";
import * as claims from "../../../state/claims/store.mjs";
import { loadIndex } from "../../../state/index/build.mjs";
import { httpError } from "../boundary.mjs";
import { checkItemId, openScoped } from "../scope.mjs";

const FORWARD = ["fixes", "blocked_by", "relates"];

/** {id: {state, title?, status?, type?, priority?}} for every id in `ids`. */
export function relatedSummaries(records, ids) {
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

/** Validate a one-edge relation body; returns {change, expected}. */
export function relationChange(id, body) {
  const allowed = ["action", "key", "target", "expected"];
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) throw httpError(400, `unexpected fields: ${unknown.join(", ")}`);
  const { action, key, target, expected } = body;
  if (action !== "add" && action !== "remove") throw httpError(400, "action must be add or remove");
  if (!RELATION_KEYS.includes(key))
    throw httpError(400, `key must be one of ${RELATION_KEYS.join(", ")}`);
  if (!ID_RE.test(target ?? "")) throw httpError(400, "target must be an item id");
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    throw httpError(400, "expected revisions are required");
  }
  for (const [k, v] of Object.entries(expected)) {
    if (!ID_RE.test(k) || typeof v !== "string")
      throw httpError(400, "bad expected revision entry");
  }
  if (typeof expected[id] !== "string")
    throw httpError(400, `expected revision for ${id} is required`);
  const remove = action === "remove";
  const change = key === "parent" ? { parent: target, remove } : { [key]: [target], remove };
  return { change, expected };
}

export function relationRoutes(deps) {
  const { catalog } = deps;
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
    {
      method: "POST",
      path: "/api/repos/:repo/checkouts/:checkout/items/:id/relations",
      handler: ({ params, body }) => {
        const id = checkItemId(params.id);
        const { change, expected } = relationChange(id, body);
        const { repo, checkout, ctx } = openScoped(deps, params, { fresh: true });
        const { value, written } = mutateStore(ctx, (s) =>
          planLink(s, id, change, { expect: expected[id], expectRevisions: expected }),
        );
        catalog.invalidate(repo, checkout);
        return { changes: value.changes, written, relations: relationsOf(ctx, id) };
      },
    },
  ];
}
