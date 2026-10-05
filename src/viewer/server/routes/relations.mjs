// Relations of one item in one registered checkout:
//   GET  /api/repos/:repo/checkouts/:checkout/items/:id/relations
//   POST /api/repos/:repo/checkouts/:checkout/items/:id/relations  one edge:
//        {action: add | remove, key: parent | fixes | blocked_by | relates, target, expected: {id: rev}}
// The read model is core relationsView (forward and reverse edges, summaries, fresh revisions). An edit
// runs core linkItem exactly as `docket link` does, with every rewritten file's revision required up
// front (reverse-stored relates included), so a stale edit is a 409 before any write.
import { ID_RE, RELATION_KEYS } from "../../../core/format/schema.mjs";
import { linkItem } from "../../../core/items/link.mjs";
import { relationsView } from "../../../core/items/relations-view.mjs";
import * as claims from "../../../state/claims/store.mjs";
import { loadIndex } from "../../../state/index/build.mjs";
import { httpError, pickFields } from "../boundary.mjs";
import { checkItemId, mutateScoped, openScoped } from "../scope.mjs";

const relationsOf = (ctx, id) =>
  relationsView(ctx, id, { records: loadIndex(ctx).records, claims });

/** Validate a one-edge relation body; returns {change, expected}. */
export function relationChange(id, body) {
  pickFields(body, { allowed: ["action", "key", "target"], expected: "map" });
  const { action, key, target, expected } = body;
  if (action !== "add" && action !== "remove") throw httpError(400, "action must be add or remove");
  if (!RELATION_KEYS.includes(key))
    throw httpError(400, `key must be one of ${RELATION_KEYS.join(", ")}`);
  if (!ID_RE.test(target ?? "")) throw httpError(400, "target must be an item id");
  if (typeof expected[id] !== "string")
    throw httpError(400, `expected revision for ${id} is required`);
  const remove = action === "remove";
  const change = key === "parent" ? { parent: target, remove } : { [key]: [target], remove };
  return { change, expected };
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
    {
      method: "POST",
      path: "/api/repos/:repo/checkouts/:checkout/items/:id/relations",
      handler: ({ params, body }) => {
        const { change, expected } = relationChange(checkItemId(params.id), body);
        return mutateScoped(deps, params, (ctx, id) => {
          const { changes, written } = linkItem(ctx, id, change, {
            expect: expected[id],
            expectRevisions: expected,
          });
          return { changes, written, relations: relationsOf(ctx, id) };
        });
      },
    },
  ];
}
