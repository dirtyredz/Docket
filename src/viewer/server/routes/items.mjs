// Item resources of one registered checkout:
//   GET  /api/repos/:repo/checkouts/:checkout/items        board (every item, core order, + invalid)
//   GET  /api/repos/:repo/checkouts/:checkout/items/:id    detail (fresh bytes, rendered body)
import { readItem } from "../../../core/items/detail.mjs";
import * as claims from "../../../state/claims/store.mjs";
import { loadIndex } from "../../../state/index/build.mjs";
import { resolveDocuments } from "../../documents/catalog.mjs";
import {
  documentLinkResolver,
  renderMarkdown,
} from "../../documents/render.mjs";
import { httpError } from "../boundary.mjs";
import { checkItemId, openScoped } from "../scope.mjs";

const BASE = "/api/repos/:repo/checkouts/:checkout/items";

export function itemRoutes(deps) {
  const { catalog } = deps;
  return [
    {
      method: "GET",
      path: BASE,
      handler: ({ params }) => {
        const { repo, checkout } = openScoped(deps, params);
        const entry = catalog.ensure(repo, checkout, { reload: true });
        if (entry.state !== "ready")
          throw httpError(503, `checkout unavailable: ${entry.reason}`);
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
        const { data } = readItem(ctx, id, {
          records: loadIndex(ctx).records,
          claims,
        });
        const docs = resolveDocuments(ctx.root, repo.docs);
        const resolveLink = documentLinkResolver(`docs/items/${id}.md`, docs);
        return {
          ...data,
          bodyHtml: renderMarkdown(data.body, { resolveLink }),
        };
      },
    },
  ];
}
