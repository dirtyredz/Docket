// Notes panel, labelled untrusted: chronological discussion entries (author, state, ref), the payload
// always as PLAIN TEXT (textContent in a pre-wrap block, never innerHTML), an Add-note draft and a
// Resolve button on open notes. A malformed Notes section shows its raw source with a warning and no
// actions. Add and Resolve never retry after a 409: the add keeps the typed text and asks for
// "Use current as base"; a resolve refreshes the notes and needs another click.
import { api } from "../../api.mjs";
import { h } from "../../dom.mjs";
import { activeKinds, discardDraft, draftKey, editText, getDraft, isDirty } from "../../drafts.mjs";
import { conflictPanel, createSaver } from "./conflict-save.mjs";

const notices = new Map(); // draft key -> one-shot message shown after a refresh

function entry(note, onResolve) {
  return h(
    "article",
    {
      class: `note ${note.state}`,
      "data-testid": "note",
      "data-ref": note.ref,
      "data-state": note.state,
    },
    h(
      "header",
      {},
      h("span", { class: `badge author-${note.author}` }, note.author),
      h("span", { class: "badge" }, note.state),
      h("code", {}, note.ref),
      note.state === "open"
        ? h(
            "button",
            { type: "button", "data-testid": "note-resolve", onclick: () => onResolve(note) },
            "Resolve",
          )
        : null,
    ),
    h("pre", { class: "note-text", "data-testid": "note-text" }, note.text),
  );
}

function noteConflict(draft, saver) {
  return conflictPanel({
    testid: "note-conflict",
    headline: "This item changed since you started typing your note.",
    detail: [
      h("p", {}, "The notes above show the current state. Your text is kept:"),
      h("pre", { class: "note-text" }, draft.text),
    ],
    actions: [saver.rebaseAction("note-rebase")],
  });
}

/** env: {ctx, item, route, syncAll}. Returns {el, sync()}. */
export function notesPanel({ ctx, item, route, syncAll }) {
  const key = draftKey(route.repo, route.checkout, item.id, "note");
  const el = h("section", { class: "panel notes untrusted", "data-testid": "notes-panel" });
  el.append(h("h2", {}, "Notes — untrusted discussion"));
  if (item.notesMalformed) {
    el.append(
      h(
        "p",
        { class: "error" },
        "The Notes section is malformed; showing the raw source. Fix it by hand.",
      ),
      h("pre", { class: "note-text", "data-testid": "notes-source" }, item.notesSource ?? ""),
    );
    return { el, sync() {} };
  }
  const draft = getDraft(key);
  const notice = notices.get(key);
  notices.delete(key);
  const msg = h("p", { class: "muted", role: "status", "data-testid": "note-message" });
  const saver = createSaver({ ctx, route, item, key, syncAll, message: msg });

  const resolve = (note) =>
    saver.act(
      () =>
        api.resolveNote(route.repo, route.checkout, item.id, note.ref, {
          expected: item.revision,
        }),
      () => {
        notices.set(key, "The notes changed elsewhere and were refreshed. Click Resolve again.");
        return ctx.reload();
      },
    );

  const add = () =>
    saver.save((d) =>
      api.addNote(route.repo, route.checkout, item.id, { expected: d.base.revision, text: d.text }),
    );

  el.append(
    notice
      ? h("div", { class: "conflict", role: "alert", "data-testid": "note-conflict" }, notice)
      : null,
    item.notes.length
      ? h(
          "div",
          { class: "note-list" },
          item.notes.map((n) => entry(n, resolve)),
        )
      : h("p", { class: "muted" }, "No notes."),
    h(
      "textarea",
      {
        rows: 3,
        placeholder: "Add a note (plain text; discussion, not facts)",
        "aria-label": "New note",
        "data-testid": "note-add-input",
        oninput: (e) => {
          editText(key, "note", item, e.target.value);
          syncAll();
        },
      },
      draft?.text ?? "",
    ),
    draft?.conflict ? noteConflict(draft, saver) : null,
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        { type: "button", class: "primary", "data-testid": "note-add", onclick: add },
        "Add note",
      ),
      h(
        "button",
        {
          type: "button",
          "data-testid": "note-discard",
          onclick: () => {
            discardDraft(key);
            ctx.reload();
          },
        },
        "Discard",
      ),
    ),
    msg,
  );

  function sync() {
    const d = getDraft(key);
    const others = activeKinds(route.repo, route.checkout, item.id).some((k) => k !== "note");
    el.querySelector('[data-testid="note-add"]').disabled =
      !isDirty(d) || Boolean(d?.conflict) || others || saver.busy;
    el.querySelector('[data-testid="note-discard"]').disabled = !d;
    // Resolving moves the revision: not while any unsaved edit (including this panel's own) exists.
    const anyActive = activeKinds(route.repo, route.checkout, item.id).length > 0;
    for (const b of el.querySelectorAll('[data-testid="note-resolve"]'))
      b.disabled = anyActive || saver.busy;
  }
  return { el, sync };
}
