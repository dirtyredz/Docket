// Facts body of one item in one registered checkout:
//   POST /api/repos/:repo/checkouts/:checkout/items/:id/body   {expected, body}
// A deliberate rewrite of the exact source after the H1 (the detail's bodySource), through core
// replaceBody on exactly the selected checkout, re-verified for the request. Frontmatter, title and
// Notes are kept byte for byte; a stale `expected` (also for an unchanged body) is a 409.
import { replaceBody } from "../../../core/items/content/body.mjs";
import { httpError } from "../boundary.mjs";
import { checkItemId, openScoped } from "../scope.mjs";

const BASE = "/api/repos/:repo/checkouts/:checkout/items/:id";

/** Validate {expected, body}; anything else is refused. */
export function bodyRequest(req) {
  const unknown = Object.keys(req).filter((k) => k !== "expected" && k !== "body");
  if (unknown.length) throw httpError(400, `not accepted here: ${unknown.join(", ")}`);
  if (typeof req.expected !== "string" || !req.expected) {
    throw httpError(400, "expected revision is required");
  }
  if (typeof req.body !== "string") throw httpError(400, "body must be a string");
  return { expected: req.expected, body: req.body };
}

export function bodyRoutes(deps) {
  return [
    {
      method: "POST",
      path: `${BASE}/body`,
      handler: ({ params, body: request }) => {
        const id = checkItemId(params.id);
        const { expected, body } = bodyRequest(request);
        const { repo, checkout, ctx } = openScoped(deps, params, { fresh: true });
        const out = replaceBody(ctx, id, body, { expect: expected });
        deps.catalog.invalidate(repo, checkout);
        return out;
      },
    },
  ];
}
