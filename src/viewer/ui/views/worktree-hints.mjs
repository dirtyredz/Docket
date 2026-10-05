// Advisory worktree hints: each Git worktree of the clone with branch, registration and claims, and when
// it was observed. Registered checkouts link to their board (the only way to edit there); unregistered
// ones show how to register them.
import { h, replace } from "../dom.mjs";

export function renderWorktreeHints(el, hints, { repoId }) {
  const rows = hints.worktrees.map((w) =>
    h(
      "tr",
      {},
      h("td", {}, h("code", {}, w.path), w.main ? " (main)" : "", w.exists ? "" : " (missing)"),
      h("td", {}, w.branch ?? (w.detached ? "detached" : "—")),
      h(
        "td",
        {},
        w.checkoutId
          ? h(
              "a",
              { href: `#/r/${repoId}/${w.checkoutId}/board` },
              w.preferred ? "board (preferred)" : "board",
            )
          : h(
              "span",
              { class: "muted" },
              "not registered: ",
              h("code", {}, `docket repo add "${w.path}"`),
            ),
      ),
      h(
        "td",
        {},
        w.claims.length
          ? w.claims.map((c) =>
              h("div", {}, h("code", {}, c.id), ` ${c.agent ?? ""} since ${c.at}`),
            )
          : h("span", { class: "muted" }, "none"),
      ),
    ),
  );
  replace(
    el,
    h("h1", {}, "Worktrees"),
    h(
      "p",
      { class: "muted" },
      `Hints only (claims are advisory and local to this clone). Observed ${new Date(hints.observedAt).toLocaleTimeString()}.`,
    ),
    h(
      "table",
      { class: "overview" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ["Worktree", "Branch", "Checkout", "Claims"].map((t) => h("th", {}, t)),
        ),
      ),
      h("tbody", {}, rows),
    ),
  );
}
