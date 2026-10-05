// Relations of one item: parent and children, fixes and the bugs filed against it (reverse `fixes`),
// blockers and the items it blocks, symmetric relates. Every target links within the same checkout;
// missing or malformed targets are shown as such.
import { h } from "../dom.mjs";

const SECTIONS = [
  { label: "Parent", get: (r) => (r.forward.parent ? [r.forward.parent] : []), key: "parent" },
  { label: "Children", get: (r) => r.reverse.children },
  { label: "Fixes", get: (r) => r.forward.fixes, key: "fixes" },
  { label: "Bugs against this", get: (r) => r.reverse.fixedBy, testid: "bugs" },
  { label: "Blocked by", get: (r) => r.forward.blocked_by, key: "blocked_by" },
  { label: "Blocks", get: (r) => r.reverse.blocks },
  { label: "Relates", get: (r) => r.reverse.relates, key: "relates" },
];

function target(base, id, info) {
  const state = info?.state ?? "missing";
  return [
    h("a", { href: `${base}/board/${id}` }, h("code", {}, id)),
    state === "ok"
      ? [h("span", { class: `status ${info.status}` }, info.status), h("span", {}, info.title)]
      : h("span", { class: "missing" }, state === "missing" ? "missing item" : "malformed item"),
  ];
}

/**
 * Relations block. options.removeAction(key, target) returns a control (or null) for an editable
 * edge; options.addForm is appended when given.
 */
export function relationsBlock(rel, { base, removeAction = () => null, addForm = null }) {
  return h(
    "section",
    { class: "relations", "data-testid": "relations" },
    h("h2", {}, "Relations"),
    SECTIONS.map((s) => {
      const ids = s.get(rel);
      if (!ids.length) return null;
      return h(
        "div",
        { "data-testid": `rel-${s.testid ?? s.key ?? s.label.toLowerCase()}` },
        h("h3", { class: "muted" }, s.label),
        h(
          "ul",
          { class: "rel-list" },
          ids.map((id) =>
            h(
              "li",
              { "data-rel-target": id },
              target(base, id, rel.related[id]),
              s.key ? removeAction(s.key, id) : null,
            ),
          ),
        ),
      );
    }),
    SECTIONS.every((s) => !s.get(rel).length) ? h("p", { class: "muted" }, "No relations.") : null,
    addForm,
  );
}
