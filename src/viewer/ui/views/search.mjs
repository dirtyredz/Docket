// Cross-repo title search results, qualified by repo, with coverage so partial results say so.
import { h, replace } from "../dom.mjs";
import { coverageText } from "./overview.mjs";

export function renderSearch(el, result) {
  const notice = result.complete
    ? `${result.matched} match(es) across ${coverageText(result.coverage)}`
    : `${result.matched} match(es) so far; searched ${coverageText(result.coverage)} (results incomplete)`;
  replace(
    el,
    h("h1", {}, `Search: ${result.query}`),
    h("p", { class: result.complete ? "muted" : "warn", "data-testid": "search-coverage" }, notice),
    result.truncated ? h("p", { class: "muted" }, "Showing the first 200 matches.") : null,
    h(
      "ul",
      { class: "results" },
      result.results.map((r) =>
        h(
          "li",
          {},
          h("span", { class: "alias" }, r.alias),
          h("span", { class: `pill ${r.priority}` }, r.priority),
          h("span", { class: `status ${r.status}` }, r.status),
          h("a", { href: `#/r/${r.repoId}/${r.checkoutId}/board/${r.id}` }, r.title),
          h("code", { class: "muted" }, r.id),
        ),
      ),
    ),
  );
}
