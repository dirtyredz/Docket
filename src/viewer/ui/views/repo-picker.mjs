// Sidebar repo switcher: "All repos" plus every registered repo with its open count or state.
import { h, replace } from "../dom.mjs";

export function renderRepoPicker(el, overview, current) {
  const repos = overview?.repos ?? [];
  const item = (href, label, note, active, testid) =>
    h(
      "li",
      {},
      h(
        "a",
        {
          href,
          class: active ? "active" : "",
          "aria-current": active ? "page" : null,
          "data-testid": testid,
        },
        h("span", { class: "name" }, label),
        h("span", { class: "note" }, note),
      ),
    );
  replace(
    el,
    h(
      "ul",
      { class: "repo-list" },
      item("#/", "All repos", String(repos.length), !current, "repo-all"),
      repos.map((r) =>
        item(
          `#/r/${r.id}/${r.preferred}/board`,
          r.alias,
          r.state === "ready" ? String(r.counts.open) : r.state === "loading" ? "…" : "!",
          current === r.id,
          `repo-${r.alias}`,
        ),
      ),
    ),
  );
}

/**
 * Header of a repo view: alias, the checkout selector (preferred marked; switching keeps the view) and
 * the board / docs / worktrees tabs.
 */
export function repoHeader(repo, route, onCheckout) {
  const base = `#/r/${repo.id}/${route.checkout}`;
  const tab = (view, label) =>
    h("a", { href: `${base}/${view}`, class: route.view === view ? "active" : "" }, label);
  const select = h(
    "select",
    {
      "aria-label": "Checkout",
      "data-testid": "checkout-select",
      onchange: (e) => onCheckout(e.target.value),
    },
    repo.checkouts.map((c) =>
      h(
        "option",
        { value: c.id, selected: c.id === route.checkout },
        `${c.path}${c.preferred ? " (preferred)" : ""}`,
      ),
    ),
  );
  return h(
    "div",
    { class: "toolbar" },
    h("h1", {}, repo.alias),
    select,
    h(
      "nav",
      { class: "tabs" },
      tab("board", "Board"),
      tab("docs", "Docs"),
      tab("worktrees", "Worktrees"),
    ),
    repo.state === "unavailable" && route.checkout === repo.preferred
      ? h("span", { class: "error" }, `preferred checkout unavailable: ${repo.reason}`)
      : null,
  );
}
