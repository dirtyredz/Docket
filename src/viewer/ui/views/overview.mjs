// All-repos overview: one row per logical repo (its preferred checkout), open totals by priority and
// todo/wip, zero buckets shown, invalid-item counts, loading and unavailable states.
import { h, replace } from "../dom.mjs";

const PRIORITIES = ["P0", "P1", "P2", "P3"];

export function coverageText(coverage) {
  const { total, ready, loading, unavailable } = coverage;
  if (ready === total) return `${total} repo(s)`;
  const parts = [`${ready} of ${total} loaded`];
  if (loading) parts.push(`${loading} loading`);
  if (unavailable) parts.push(`${unavailable} unavailable`);
  return parts.join(", ");
}

export function renderOverview(el, overview) {
  const head = h(
    "tr",
    {},
    h("th", { scope: "col" }, "Repo"),
    PRIORITIES.map((p) => h("th", { scope: "col", class: "num" }, p)),
    h("th", { scope: "col", class: "num" }, "todo"),
    h("th", { scope: "col", class: "num" }, "wip"),
    h("th", { scope: "col", class: "num" }, "open"),
    h("th", { scope: "col", class: "num" }, "invalid"),
    h("th", { scope: "col" }, "State"),
  );
  const rows = overview.repos.map((r) => {
    const counts = r.counts;
    const cell = (v) => h("td", { class: `num${v === 0 ? " zero" : ""}` }, counts ? String(v) : "");
    return h(
      "tr",
      { "data-testid": `overview-${r.alias}`, class: r.state },
      h("th", { scope: "row" }, h("a", { href: `#/r/${r.id}/${r.preferred}/board` }, r.alias)),
      PRIORITIES.map((p) => cell(counts?.[p])),
      cell(counts?.todo),
      cell(counts?.wip),
      cell(counts?.open),
      cell(r.invalid),
      h(
        "td",
        { class: "state" },
        r.state === "unavailable"
          ? h("span", { title: r.reason }, `unavailable: ${r.reason}`)
          : r.state,
      ),
    );
  });
  replace(
    el,
    h("h1", {}, "All repos"),
    h("p", { class: "muted", "data-testid": "coverage" }, coverageText(overview.coverage)),
    overview.registryError
      ? h("p", { class: "error" }, `Registry: ${overview.registryError}`)
      : null,
    overview.repos.length
      ? h("table", { class: "overview" }, h("thead", {}, head), h("tbody", {}, rows))
      : h("p", {}, "No repos registered. Run ", h("code", {}, "docket repo scan <dir>"), "."),
  );
}
