// Item resources of one registered checkout:
//   GET  /api/repos/:repo/checkouts/:checkout/items        board (every item, core order, + invalid)
//   GET  /api/repos/:repo/checkouts/:checkout/items/:id    detail (fresh bytes, rendered body)
//   POST /api/repos/:repo/checkouts/:checkout/items/:id    scalar save {expected, status?, priority?, title?}
// Saves call core setItem (date, rank and claim-cleanup rules included) on exactly the selected checkout,
// re-verified for the request; a stale `expected` is a 409. Bodies, identity, rank and other fields are
// not editable here.
import { ENUMS } from "../../../core/format/schema.mjs";
import { localDate } from "../../../core/identity/date.mjs";
import { setItem } from "../../../core/items/complete.mjs";
import { readItem } from "../../../core/items/detail.mjs";
import * as claims from "../../../state/claims/store.mjs";
import { loadIndex } from "../../../state/index/build.mjs";
import { resolveDocuments } from "../../documents/catalog.mjs";
import { documentLinkResolver, renderMarkdown } from "../../documents/render.mjs";
import { httpError } from "../boundary.mjs";
import { checkItemId, openScoped } from "../scope.mjs";

const BASE = "/api/repos/:repo/checkouts/:checkout/items";
const SCALARS = ["status", "priority", "title"];

/** Validate a scalar save body; returns {expected, changes}. Unknown or body fields are refused. */
export function scalarChanges(body) {
  const unknown = Object.keys(body).filter((k) => k !== "expected" && !SCALARS.includes(k));
  if (unknown.length) throw httpError(400, `not editable here: ${unknown.join(", ")}`);
  if (typeof body.expected !== "string" || !body.expected) {
    throw httpError(400, "expected revision is required");
  }
  const changes = {};
  for (const k of SCALARS) {
    if (body[k] === undefined) continue;
    if (typeof body[k] !== "string") throw httpError(400, `${k} must be a string`);
    if (k !== "title" && !ENUMS[k].includes(body[k])) {
      throw httpError(400, `${k} must be one of ${ENUMS[k].join(", ")}`);
    }
    changes[k] = body[k];
  }
  if (!Object.keys(changes).length) throw httpError(400, "nothing to save");
  return { expected: body.expected, changes };
}

export function itemRoutes(deps) {
  const { catalog } = deps;
  return [
    {
      method: "GET",
      path: BASE,
      handler: ({ params }) => {
        const { repo, checkout } = openScoped(deps, params);
        const entry = catalog.ensure(repo, checkout, { reload: true });
        if (entry.state !== "ready") throw httpError(503, `checkout unavailable: ${entry.reason}`);
        return {
          repo: { id: repo.id, alias: repo.alias },
          checkout: {
            id: checkout.id,
            path: checkout.path,
            preferred: checkout.id === repo.preferred,
          },
          items: entry.items,
          invalid: entry.invalid,
          loadedAt: entry.loadedAt,
        };
      },
    },
    {
      method: "GET",
      path: `${BASE}/:id`,
      handler: ({ params }) => {
        const id = checkItemId(params.id);
        const { repo, ctx } = openScoped(deps, params);
        const { data } = readItem(ctx, id, { records: loadIndex(ctx).records, claims });
        const docs = resolveDocuments(ctx.root, repo.docs);
        const resolveLink = documentLinkResolver(`docs/items/${id}.md`, docs);
        return { ...data, bodyHtml: renderMarkdown(data.body, { resolveLink }) };
      },
    },
    {
      method: "POST",
      path: `${BASE}/:id`,
      handler: ({ params, body }) => {
        const id = checkItemId(params.id);
        const { expected, changes } = scalarChanges(body);
        const { repo, checkout, ctx } = openScoped(deps, params, { fresh: true });
        const { data, warnings } = setItem(ctx, id, changes, {
          today: localDate(),
          expect: expected,
          claims,
        });
        catalog.invalidate(repo, checkout);
        return { ...data, warnings };
      },
    },
  ];
}
