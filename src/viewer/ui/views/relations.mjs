// Relations of one item: parent and children, fixes and the bugs filed against it (reverse `fixes`),
// blockers and the items it blocks, symmetric relates. Every target links within the same checkout;
// missing or malformed targets are shown as such.
import { api } from "../api.mjs";
import { h } from "../dom.mjs";

const REL_KEYS = ["parent", "fixes", "blocked_by", "relates"];

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

/**
 * One-edge relation actions for the item editor: a remove button per editable edge and an add form.
 * Each action sends every revision the edit may rewrite; a 409 reloads instead of retrying.
 */
export function relationControls(ctx) {
  const { route, base } = ctx;
  const controls = [];
  const note = h("p", { class: "muted", "data-testid": "relations-note" });
  const act = async (relations, action, relKey, target) => {
    try {
      await api.relate(route.repo, route.checkout, relations.id, {
        action,
        key: relKey,
        target,
        expected: relations.revisions,
      });
      await ctx.onSaved([]);
    } catch (err) {
      note.textContent =
        err.status === 409 ? "Changed elsewhere; reloaded. Try again." : err.message;
      note.className = "error";
      if (err.status === 409) await ctx.reload();
    }
  };
  const track = (el) => (controls.push(el), el);
  return {
    setEnabled(on) {
      for (const c of controls) c.disabled = !on;
      note.textContent = on ? "" : "Save or discard your unsaved edits before changing relations.";
      note.className = "muted";
    },
    block(relations) {
      const keySel = track(
        h(
          "select",
          { "aria-label": "Relation", "data-testid": "rel-key" },
          REL_KEYS.map((k) => h("option", { value: k }, k)),
        ),
      );
      const target = track(
        h("input", {
          placeholder: "dk-xxxxxxxx",
          "aria-label": "Target item id",
          "data-testid": "rel-target",
        }),
      );
      const add = track(h("button", { type: "submit", "data-testid": "rel-add" }, "Add"));
      const form = h(
        "form",
        {
          class: "actions",
          onsubmit: (e) => {
            e.preventDefault();
            act(relations, "add", keySel.value, target.value.trim());
          },
        },
        keySel,
        target,
        add,
      );
      return relationsBlock(relations, {
        base,
        removeAction: (relKey, id) =>
          track(
            h(
              "button",
              {
                type: "button",
                title: `Remove ${relKey} ${id}`,
                "data-testid": `rel-remove-${relKey}-${id}`,
                onclick: () => act(relations, "remove", relKey, id),
              },
              "remove",
            ),
          ),
        addForm: [form, note],
      });
    },
  };
}
