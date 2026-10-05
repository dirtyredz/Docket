// Read-only living documents: the seven names with the chosen source (and duplicates or a missing
// override), the selected document as server-sanitized HTML, or its source as plain text.
import { h, replace } from "../dom.mjs";

export function renderDocuments(el, { list, doc, base, name, source }) {
  const items = list.documents.map((d) =>
    h(
      "li",
      {},
      d.source
        ? h("a", { href: `${base}/docs/${d.name}`, class: d.name === name ? "active" : "" }, d.name)
        : h("span", { class: "muted", title: "not found" }, d.name),
      d.duplicates.length
        ? h("span", { class: "warn", title: d.duplicates.join(", ") }, " (dup)")
        : null,
      d.overrideMissing
        ? h("span", { class: "error" }, ` (override ${d.overrideMissing} missing)`)
        : null,
    ),
  );
  let body = h("p", { class: "muted" }, "Choose a document.");
  if (doc) {
    const header = h(
      "p",
      { class: "muted" },
      `${doc.source} (${doc.via})`,
      doc.duplicates.length ? ` — also found: ${doc.duplicates.join(", ")}` : "",
      " · ",
      h(
        "a",
        { href: `${base}/docs/${doc.name}${source ? "" : "/source"}` },
        source ? "rendered" : "source",
      ),
    );
    if (source) {
      body = [header, h("pre", { class: "source", "data-testid": "doc-source" }, doc.text)];
    } else {
      const html = h("div", { class: "markdown", "data-testid": "doc-html" });
      html.innerHTML = doc.html; // sanitized server-side; CSP blocks scripts regardless
      for (const a of html.querySelectorAll('a[href^="#doc/"]')) {
        a.setAttribute("href", `${base}/docs/${a.getAttribute("href").slice(5)}`);
      }
      body = [header, html];
    }
  }
  replace(el, h("ul", { class: "doc-list", "data-testid": "doc-list" }, items), body);
}
