// Item detail: composes the scalar, facts (body), notes and relations panels. Each panel owns its own
// session draft (see drafts.mjs); while one has unsaved input the others' mutation buttons are
// disabled (syncAll), so one revision is never raced by two panels. Fields come from the item's
// current bytes; every successful save re-fetches so all panels base on the returned revision.
import { h, replace } from "../dom.mjs";
import { activeKinds } from "../drafts.mjs";
import { bodyPanel } from "./item/body-editor.mjs";
import { notesPanel } from "./item/notes.mjs";
import { scalarPanel } from "./item/scalar-editor.mjs";
import { relationControls } from "./relations.mjs";

const READ_ONLY = ["type", "area", "created", "since", "rank"];

/**
 * Render the panel. ctx: {item, relations, base, query, route: {repo, checkout}, reload(), onSaved()}.
 */
export function renderItemDetail(el, ctx) {
  const { item, relations, base, route } = ctx;
  const panels = [];
  const syncAll = () => panels.forEach((p) => p.sync());
  const env = { ctx, item, route, base, syncAll };

  const scalar = scalarPanel(env);
  const facts = bodyPanel(env);
  const notes = notesPanel(env);
  const relationCtl = relationControls(ctx);
  panels.push(scalar, facts, notes, {
    sync: () => relationCtl.setEnabled(!activeKinds(route.repo, route.checkout, item.id).length),
  });

  replace(
    el,
    h(
      "p",
      {},
      h("a", { href: `${base}/board${ctx.query ?? ""}` }, "close (Esc)"),
      " ",
      h("code", {}, item.id),
    ),
    h("h1", { "data-testid": "detail-title" }, item.title ?? item.id),
    item.errors?.length
      ? h(
          "ul",
          { class: "error" },
          item.errors.map((e) => h("li", {}, e.message)),
        )
      : null,
    item.blocked ? h("p", {}, h("span", { class: "badge blocked" }, "blocked")) : null,
    scalar.el,
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
    facts.el,
    notes.el,
  );
  syncAll();
}
