// Discussion notes of one item in one registered checkout:
//   POST /api/repos/:repo/checkouts/:checkout/items/:id/notes                {expected, text}
//   POST /api/repos/:repo/checkouts/:checkout/items/:id/notes/:ref/resolve   {expected}
// Notes added here are owner-authored. Both run core note operations on exactly the selected checkout,
// re-verified for the request; a stale `expected` (also for an already-resolved note) is a 409.
import { addNote, resolveNote } from "../../../core/items/content/notes.mjs";
import { httpError, pickFields } from "../boundary.mjs";
import { mutateScoped } from "../scope.mjs";

const BASE = "/api/repos/:repo/checkouts/:checkout/items/:id/notes";

/** Validate {expected, text}. */
export function noteRequest(req) {
  pickFields(req, { allowed: ["text"], expected: true });
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
  return [
    {
      method: "POST",
      path: BASE,
      handler: ({ params, body }) => {
        const { expected, text } = noteRequest(body);
        return mutateScoped(deps, params, (ctx, id) =>
          addNote(ctx, id, { text, author: "owner" }, { expect: expected }),
        );
      },
    },
    {
      method: "POST",
      path: `${BASE}/:ref/resolve`,
      handler: ({ params, body }) => {
        const { expected } = pickFields(body, { allowed: [], expected: true });
        const ref = decodeRef(params.ref);
        return mutateScoped(deps, params, (ctx, id) =>
          resolveNote(ctx, id, ref, { expect: expected }),
        );
      },
    },
  ];
}
