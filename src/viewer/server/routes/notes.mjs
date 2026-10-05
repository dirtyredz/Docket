// Discussion notes of one item in one registered checkout:
//   POST /api/repos/:repo/checkouts/:checkout/items/:id/notes                {expected, text}
//   POST /api/repos/:repo/checkouts/:checkout/items/:id/notes/:ref/resolve   {expected}
// Notes added here are owner-authored. Both run core note operations on exactly the selected checkout,
// re-verified for the request; a stale `expected` (also for an already-resolved note) is a 409.
import { addNote, resolveNote } from "../../../core/items/content/notes.mjs";
import { httpError } from "../boundary.mjs";
import { checkItemId, openScoped } from "../scope.mjs";

const BASE = "/api/repos/:repo/checkouts/:checkout/items/:id/notes";

function requireOnly(req, keys) {
  const unknown = Object.keys(req).filter((k) => !keys.includes(k));
  if (unknown.length) throw httpError(400, `not accepted here: ${unknown.join(", ")}`);
  if (typeof req.expected !== "string" || !req.expected) {
    throw httpError(400, "expected revision is required");
  }
}

/** Validate {expected, text}. */
export function noteRequest(req) {
  requireOnly(req, ["expected", "text"]);
  if (typeof req.text !== "string") throw httpError(400, "text must be a string");
  return { expected: req.expected, text: req.text };
}

function decodeRef(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw httpError(400, "malformed note reference");
  }
}

export function noteRoutes(deps) {
  const mutate = (params, run) => {
    const id = checkItemId(params.id);
    const { repo, checkout, ctx } = openScoped(deps, params, { fresh: true });
    const out = run(ctx, id);
    deps.catalog.invalidate(repo, checkout);
    return out;
  };
  return [
    {
      method: "POST",
      path: BASE,
      handler: ({ params, body }) => {
        const { expected, text } = noteRequest(body);
        return mutate(params, (ctx, id) =>
          addNote(ctx, id, { text, author: "owner" }, { expect: expected }),
        );
      },
    },
    {
      method: "POST",
      path: `${BASE}/:ref/resolve`,
      handler: ({ params, body }) => {
        requireOnly(body, ["expected"]);
        const ref = decodeRef(params.ref);
        return mutate(params, (ctx, id) => resolveNote(ctx, id, ref, { expect: body.expected }));
      },
    },
  ];
}
