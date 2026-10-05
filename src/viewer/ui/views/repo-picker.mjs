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
