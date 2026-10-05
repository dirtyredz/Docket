// Item detail panel: fields read from the item's current bytes, claim, rendered (read-only) body and
// relations.
import { h, replace } from "../dom.mjs";
import { relationsBlock } from "./relations.mjs";

const FIELDS = [
  "type",
  "status",
  "priority",
  "area",
  "created",
  "since",
  "rank",
];

function fieldTable(item) {
  return h(
    "table",
    { class: "fields" },
    FIELDS.map((k) => h("tr", {}, h("th", {}, k), h("td", {}, item[k] || "—"))),
    h(
      "tr",
      {},
      h("th", {}, "revision"),
      h("td", {}, h("code", {}, item.revision)),
    ),
  );
}

export function renderItemDetail(el, { item, relations, base }) {
  const errors = item.errors?.length
    ? h(
        "ul",
        { class: "error" },
        item.errors.map((e) => h("li", {}, e.message)),
      )
    : null;
  replace(
    el,
    h(
      "p",
      {},
      h("a", { href: `${base}/board` }, "close (Esc)"),
      " ",
      h("code", {}, item.id),
    ),
    h("h1", { "data-testid": "detail-title" }, item.title ?? item.id),
    errors,
    item.blocked ? h("p", { class: "badge blocked" }, "blocked") : null,
    fieldTable(item),
    item.claim
      ? h(
          "p",
          { class: "muted" },
          `Claimed (advisory) by ${item.claim.worktree}${item.claim.branch ? ` on ${item.claim.branch}` : ""}`,
        )
      : null,
    relations ? relationsBlock(relations, { base }) : null,
    h("h2", {}, "Body"),
    bodyBlock(item, base),
  );
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
