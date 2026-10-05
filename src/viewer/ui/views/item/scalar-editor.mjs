// Scalar panel: title, status and priority edited as one session draft and saved together against the
// revision they were based on. A 409 keeps the draft, shows the server's values beside it and waits
// for an explicit choice (keep mine on the current version, or discard).
import { api } from "../../api.mjs";
import { h } from "../../dom.mjs";
import {
  activeKinds,
  changedFields,
  discardDraft,
  draftKey,
  editDraft,
  getDraft,
  isDirty,
  SCALARS,
} from "../../drafts.mjs";
import { conflictPanel, createSaver } from "./conflict-save.mjs";

const ENUMS = {
  status: ["todo", "wip", "done", "dropped"],
  priority: ["P0", "P1", "P2", "P3"],
};

function input(field, value, onInput) {
  if (field === "title") {
    return h("input", {
      id: `f-${field}`,
      value,
      "data-testid": `edit-${field}`,
      oninput: (e) => onInput(e.target.value),
    });
  }
  return h(
    "select",
    { id: `f-${field}`, "data-testid": `edit-${field}`, onchange: (e) => onInput(e.target.value) },
    ENUMS[field].map((v) => h("option", { value: v, selected: v === value }, v)),
  );
}

function scalarConflict(draft, saver) {
  const c = draft.conflict;
  return conflictPanel({
    testid: "conflict",
    headline: "This item changed since you started editing.",
    detail: [
      h(
        "table",
        {},
        h("tr", {}, h("th", {}, ""), h("th", {}, "yours"), h("th", {}, "current")),
        SCALARS.map((k) =>
          h(
            "tr",
            { class: draft.values[k] !== c.values[k] ? "warn" : "" },
            h("th", {}, k),
            h("td", { "data-testid": `mine-${k}` }, draft.values[k]),
            h("td", { "data-testid": `server-${k}` }, c.values[k]),
          ),
        ),
      ),
    ],
    actions: [
      saver.rebaseAction("keep-mine", "Keep mine on current version"),
      saver.discardAction("take-server", "Discard mine"),
    ],
  });
}

/** env: {ctx, item, route, syncAll}. Returns {el, sync()}. */
export function scalarPanel({ ctx, item, route, syncAll }) {
  const key = draftKey(route.repo, route.checkout, item.id, "scalar");
  const editable = Boolean(item.type) && !item.errors?.some((e) => e.rule <= 3);
  const draft = getDraft(key);
  const values = draft?.values ?? Object.fromEntries(SCALARS.map((k) => [k, item[k] ?? ""]));
  const message = h("p", { class: "muted", role: "status", "data-testid": "editor-message" });
  const saver = createSaver({ ctx, route, item, key, syncAll, message });

  const save = () =>
    saver.save((d) =>
      api.save(route.repo, route.checkout, item.id, {
        expected: d.base.revision,
        ...changedFields(d),
      }),
    );

  const form = editable
    ? h(
        "form",
        {
          class: "editor",
          onsubmit: (e) => {
            e.preventDefault();
            save();
          },
        },
        SCALARS.map((k) =>
          h(
            "div",
            { class: "field" },
            h("label", { for: `f-${k}` }, k),
            input(k, values[k], (v) => {
              editDraft(key, item, k, v);
              syncAll();
            }),
          ),
        ),
        draft?.conflict ? scalarConflict(draft, saver) : null,
        h(
          "div",
          { class: "actions" },
          h("button", { type: "submit", class: "primary", "data-testid": "save" }, "Save"),
          h(
            "button",
            {
              type: "button",
              "data-testid": "discard",
              onclick: () => {
                discardDraft(key);
                ctx.reload();
              },
            },
            "Discard",
          ),
        ),
      )
    : h("p", { class: "error" }, "Malformed item: fix the file by hand (docket check).");

  const el = h("div", {}, form, message);
  function sync() {
    const d = getDraft(key);
    const others = activeKinds(route.repo, route.checkout, item.id).some((k) => k !== "scalar");
    for (const b of el.querySelectorAll('[data-testid="save"],[data-testid="discard"]')) {
      const isSave = b.dataset.testid === "save";
      b.disabled = !isDirty(d) || (isSave && (Boolean(d?.conflict) || others || saver.busy));
    }
  }
  return { el, sync };
}
