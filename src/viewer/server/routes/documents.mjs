// Living documents of one registered checkout (read-only; there is no write endpoint):
//   GET /api/repos/:repo/checkouts/:checkout/documents              the seven names, chosen sources,
//                                                                   duplicates and missing overrides
//   GET /api/repos/:repo/checkouts/:checkout/documents/:name        sanitized HTML
//   GET /api/repos/:repo/checkouts/:checkout/documents/:name?view=source   the text, for a text view
import { readDocument, resolveDocuments } from "../../documents/catalog.mjs";
import { documentLinkResolver, renderMarkdown } from "../../documents/render.mjs";
import { DOC_NAMES } from "../../../state/registry/schema.mjs";
import { httpError } from "../boundary.mjs";
import { openScoped } from "../scope.mjs";

const BASE = "/api/repos/:repo/checkouts/:checkout/documents";

export function documentRoutes(deps) {
  return [
    {
      method: "GET",
      path: BASE,
      handler: ({ params }) => {
        const { repo, ctx } = openScoped(deps, params);
        return { documents: resolveDocuments(ctx.root, repo.docs) };
      },
    },
    {
      method: "GET",
      path: `${BASE}/:name`,
      handler: ({ params, query }) => {
        if (!DOC_NAMES.includes(params.name)) throw httpError(404, "not a living document");
        const { repo, ctx } = openScoped(deps, params);
        const entries = resolveDocuments(ctx.root, repo.docs);
        const entry = entries.find((e) => e.name === params.name);
        const text = readDocument(ctx.root, entry);
        const meta = {
          name: entry.name,
          source: entry.source,
          via: entry.via,
          duplicates: entry.duplicates,
        };
        if (query.get("view") === "source") return { ...meta, text };
        const html = renderMarkdown(text, {
          resolveLink: documentLinkResolver(entry.source, entries),
        });
        return { ...meta, html };
      },
    },
  ];
}
