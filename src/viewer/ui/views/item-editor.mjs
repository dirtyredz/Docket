// Item detail panel and editor. Fields come from the item's current bytes. Title, status and priority
// are edited as a session draft and saved together against the revision they were based on; a 409
// keeps the draft, shows the server's values beside it and waits for an explicit choice. Relations
// change one edge at a time, only while no scalar draft is pending. The body is read-only.
import { api } from "../api.mjs";
import { h, replace } from "../dom.mjs";
import {
  changedFields,
  discardDraft,
  draftKey,
  editDraft,
  getDraft,
  isDirty,
  markConflict,
  rebaseOnServer,
  SCALARS,
} from "../drafts.mjs";
import { relationControls } from "./relations.mjs";

const ENUMS = {
  status: ["todo", "wip", "done", "dropped"],
  priority: ["P0", "P1", "P2", "P3"],
};
const READ_ONLY = ["type", "area", "created", "since", "rank"];

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

function conflictPanel(draft, onRebase, onDiscard) {
  const c = draft.conflict;
  return h(
    "div",
    { class: "conflict", role: "alert", "data-testid": "conflict" },
    h("strong", {}, "This item changed since you started editing."),
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
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        { type: "button", onclick: onRebase, "data-testid": "keep-mine" },
        "Keep mine on current version",
      ),
      h(
        "button",
        { type: "button", onclick: onDiscard, "data-testid": "take-server" },
        "Discard mine",
      ),
    ),
  );
}

/**
 * Render the panel. ctx: {item, relations, base, route: {repo, checkout}, reload(), onSaved(), notify}.
 */
export function renderItemDetail(el, ctx) {
  const { item, relations, base, route } = ctx;
  const key = draftKey(route.repo, route.checkout, item.id);
  const editable = Boolean(item.type) && !item.errors?.some((e) => e.rule <= 3);
  const draft = getDraft(key);
  const values = draft?.values ?? Object.fromEntries(SCALARS.map((k) => [k, item[k] ?? ""]));
  const message = h("p", { class: "muted", role: "status", "data-testid": "editor-message" });
  const rerender = () => renderItemDetail(el, ctx);

  const save = async () => {
    const d = getDraft(key);
    if (!isDirty(d) || d.conflict) return;
    try {
      const res = await api.save(route.repo, route.checkout, item.id, {
        expected: d.base.revision,
        ...changedFields(d),
      });
      discardDraft(key);
      await ctx.onSaved(res.warnings ?? []);
    } catch (err) {
      if (err.status === 409) {
        markConflict(key, await api.item(route.repo, route.checkout, item.id));
        return rerender();
      }
      message.textContent = err.message;
      message.className = "error";
    }
  };

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
              syncButtons();
            }),
          ),
        ),
        draft?.conflict
          ? conflictPanel(
              draft,
              () => {
                rebaseOnServer(key);
                ctx.reload();
              },
              () => {
                discardDraft(key);
                ctx.reload();
              },
            )
          : null,
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
                rerender();
              },
            },
            "Discard",
          ),
        ),
      )
    : h("p", { class: "error" }, "Malformed item: fix the file by hand (docket check).");

  const relationCtl = relationControls(ctx);
  function syncButtons() {
    const d = getDraft(key);
    for (const b of el.querySelectorAll('[data-testid="save"],[data-testid="discard"]')) {
      b.disabled = !isDirty(d) || Boolean(d?.conflict && b.dataset.testid === "save");
    }
    relationCtl.setEnabled(!isDirty(d) && !d?.conflict);
  }

  replace(
    el,
    h("p", {}, h("a", { href: `${base}/board` }, "close (Esc)"), " ", h("code", {}, item.id)),
    h("h1", { "data-testid": "detail-title" }, item.title ?? item.id),
    item.errors?.length
      ? h(
          "ul",
          { class: "error" },
          item.errors.map((e) => h("li", {}, e.message)),
        )
      : null,
    item.blocked ? h("p", {}, h("span", { class: "badge blocked" }, "blocked")) : null,
    form,
    message,
    h(
      "table",
      { class: "fields" },
      READ_ONLY.map((k) => h("tr", {}, h("th", {}, k), h("td", {}, item[k] || "—"))),
      h(
        "tr",
        {},
        h("th", {}, "revision"),
        h("td", {}, h("code", { "data-testid": "revision" }, item.revision)),
      ),
    ),
    item.claim
      ? h(
          "p",
          { class: "muted" },
          `Claimed (advisory) by ${item.claim.worktree}${item.claim.branch ? ` on ${item.claim.branch}` : ""}`,
        )
      : null,
    relations ? relationCtl.block(relations) : null,
    h("h2", {}, "Body (read-only)"),
    bodyBlock(item, base),
  );
  syncButtons();
}

/** Server-sanitized Markdown (renderMarkdown + sanitize-html); never raw item text as HTML. */
export function bodyBlock(item, base) {
  const body = h("div", { class: "markdown", "data-testid": "detail-body" });
  body.innerHTML = item.bodyHtml ?? "";
  for (const a of body.querySelectorAll('a[href^="#doc/"]')) {
    a.setAttribute("href", `${base}/docs/${a.getAttribute("href").slice(5)}`);
  }
  return body;
}
