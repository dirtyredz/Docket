// /api/search?q=...&closed=1: repository-qualified title search over the indexed summaries of every
// preferred checkout. Coverage says how many repos were searched, loading or unavailable, so an
// incomplete result is never presented as complete.
import { httpError } from "../boundary.mjs";

const MAX_QUERY = 200;

export function searchRoutes({ catalog }) {
  return [
    {
      method: "GET",
      path: "/api/search",
      handler: ({ query }) => {
        const q = query.get("q") ?? "";
        if (q.length > MAX_QUERY) throw httpError(400, "query too long");
        return catalog.search(q, { closed: query.get("closed") === "1" });
      },
    },
  ];
}
