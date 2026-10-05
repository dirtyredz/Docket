// Per-checkout board: the real status columns (todo, wip, done, dropped) in core order (priority, rank,
// id). Closed columns start collapsed but stay one click away; blocked is a derived badge; malformed
// files are listed, never hidden. The "Needs discussion" filter (navigation state: ?discussion=1) shows
// only items with open notes and expands the closed columns so matching done/dropped items are visible.
import { h, replace } from "../dom.mjs";

const COLUMNS = ["todo", "wip", "done", "dropped"];
const CLOSED = new Set(["done", "dropped"]);
const expanded = new Set();

export function card(base, item, selected, query = "") {
  return h(
    "a",
    {
      class: `card${selected ? " selected" : ""}`,
      href: `${base}/board/${item.id}${query}`,
      "data-testid": `card-${item.id}`,
    },
    h("div", { class: "title" }, item.title ?? item.id),
    h(
      "div",
      { class: "meta" },
      h("span", { class: `pill ${item.priority}` }, item.priority),
      h("span", {}, item.type),
      item.blocked ? h("span", { class: "badge blocked" }, "blocked") : null,
      item.openNoteCount > 0
        ? h(
            "span",
            { class: "badge discussion", "data-testid": "discussion-badge" },
            `Needs discussion · ${item.openNoteCount}`,
          )
        : null,
      h("code", {}, item.id),
    ),
  );
}

export function renderBoard(el, board, { base, selected, rerender, discussion = false }) {
  const byStatus = Object.fromEntries(COLUMNS.map((c) => [c, []]));
  const query = discussion ? "?discussion=1" : "";
  for (const item of board.items) {
    if (!discussion || item.openNoteCount > 0) byStatus[item.status]?.push(item);
  }
  const toggleFilter = h(
    "label",
    { class: "filter" },
    h("input", {
      type: "checkbox",
      checked: discussion,
      "data-testid": "filter-discussion",
      onchange: (e) => {
        const to = e.target.checked ? "?discussion=1" : "";
        location.hash = `${base}/board${selected ? `/${selected}` : ""}${to}`;
      },
    }),
    " Needs discussion",
  );
  const column = (status) => {
    const items = byStatus[status];
    const collapsed = CLOSED.has(status) && !expanded.has(status) && !discussion;
    const toggle =
      CLOSED.has(status) && !discussion
        ? h(
            "button",
            {
              type: "button",
              "aria-expanded": String(!collapsed),
              onclick: () => {
                if (collapsed) expanded.add(status);
                else expanded.delete(status);
                rerender();
              },
            },
            collapsed ? `show ${items.length}` : "hide",
          )
        : null;
    return h(
      "section",
      { class: "column", "data-testid": `column-${status}`, "aria-label": status },
      h("h2", {}, h("span", {}, `${status} (${items.length})`), toggle),
      collapsed ? null : items.map((i) => card(base, i, i.id === selected, query)),
    );
  };
  replace(
    el,
    h("div", { class: "toolbar" }, toggleFilter),
    h("div", { class: "board" }, COLUMNS.map(column)),
    board.invalid.length
      ? h(
          "section",
          { class: "invalid" },
          h("h2", { class: "error" }, `Malformed files (${board.invalid.length})`),
          h(
            "ul",
            {},
            board.invalid.map((b) =>
              h("li", {}, h("code", {}, b.file), " ", b.errors.map((e) => e.message).join("; ")),
            ),
          ),
        )
      : null,
  );
}
