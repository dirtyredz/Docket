// Facts panel: the authoritative body as sanitized rendered Markdown, plus an Edit toggle with a
// Markdown textarea seeded from the exact `bodySource`. Save and Discard are separate. A 409 keeps the
// text, fetches the current source and shows both side by side; the user must choose "Use current as
// base" (rebase, never automatic) or Discard before saving again.
import { api } from "../../api.mjs";
import { h } from "../../dom.mjs";
import { activeKinds, discardDraft, draftKey, editText, getDraft, isDirty } from "../../drafts.mjs";
import { conflictPanel, createSaver } from "./conflict-save.mjs";

const open = new Set(); // draft keys whose editor is shown (a draft always shows it)

/** Server-sanitized Markdown (renderMarkdown + sanitize-html); never raw item text as HTML. */
export function bodyBlock(item, base) {
  const body = h("div", { class: "markdown", "data-testid": "detail-body" });
  body.innerHTML = item.bodyHtml ?? "";
  for (const a of body.querySelectorAll('a[href^="#doc/"]')) {
    a.setAttribute("href", `${base}/docs/${a.getAttribute("href").slice(5)}`);
  }
  return body;
}

function bodyConflict(draft, saver) {
  return conflictPanel({
    testid: "body-conflict",
    headline: "The facts changed since you started editing.",
    detail: [
      h(
        "div",
        { class: "side-by-side" },
        h("div", {}, h("h4", {}, "yours"), h("pre", { "data-testid": "body-mine" }, draft.text)),
        h(
          "div",
          {},
          h("h4", {}, "current"),
          h("pre", { "data-testid": "body-current" }, draft.conflict.source),
        ),
      ),
    ],
    actions: [saver.rebaseAction("body-rebase")],
    footer: h(
      "p",
      { class: "muted" },
      "Or discard your edit below. Nothing is retried automatically.",
    ),
  });
}

/** env: {ctx, item, route, base, syncAll}. Returns {el, sync()}. */
export function bodyPanel({ ctx, item, route, base, syncAll }) {
  const key = draftKey(route.repo, route.checkout, item.id, "body");
  const editable = Boolean(item.type) && !item.errors?.some((e) => e.rule <= 3);
  const draft = getDraft(key);
  const editing = Boolean(draft) || open.has(key);
  const message = h("p", { class: "muted", role: "status", "data-testid": "body-message" });
  const saver = createSaver({ ctx, route, item, key, syncAll, message });

  const save = () =>
    saver.save(
      (d) =>
        api.saveBody(route.repo, route.checkout, item.id, {
          expected: d.base.revision,
          body: d.text,
        }),
      { done: () => open.delete(key) },
    );

  const stop = () => {
    discardDraft(key);
    open.delete(key);
    ctx.reload();
  };

  const textarea = h(
    "textarea",
    {
      rows: 12,
      "data-testid": "body-textarea",
      "aria-label": "Body source (Markdown after the title)",
      oninput: (e) => {
        editText(key, "body", item, e.target.value);
        syncAll();
      },
    },
    draft?.text ?? item.bodySource ?? "",
  );

  const editor = h(
    "div",
    { class: "body-editor" },
    textarea,
    draft?.conflict ? bodyConflict(draft, saver) : null,
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        { type: "button", class: "primary", "data-testid": "body-save", onclick: save },
        "Save facts",
      ),
      h("button", { type: "button", "data-testid": "body-discard", onclick: stop }, "Discard"),
    ),
    message,
  );

  const toggle = h(
    "button",
    {
      type: "button",
      "data-testid": "body-edit",
      onclick: () => {
        open.add(key);
        ctx.reload();
      },
    },
    "Edit",
  );

  const el = h(
    "section",
    { class: "panel facts", "data-testid": "facts-panel" },
    h("h2", {}, "Body — facts"),
    bodyBlock(item, base),
    editable ? (editing ? editor : toggle) : null,
  );

  function sync() {
    const d = getDraft(key);
    const others = activeKinds(route.repo, route.checkout, item.id).some((k) => k !== "body");
    const saveBtn = el.querySelector('[data-testid="body-save"]');
    if (saveBtn) saveBtn.disabled = !isDirty(d) || Boolean(d?.conflict) || others || saver.busy;
    if (others && editing) {
      message.textContent = "Save or discard your other unsaved edit first.";
      message.className = "muted";
    } else if (!message.classList.contains("error")) message.textContent = "";
  }
  return { el, sync };
}
