// Read-only Markdown rendering for living docs and item bodies: marked, then sanitize-html with a
// strict allowlist. No raw HTML survives except allowlisted tags; no scripts, frames, forms, styles,
// event handlers or images (remote or local). Links resolve to an authorized catalog document
// (`#doc/<NAME>`), stay as plain http(s)/mailto links, or become a visibly unresolved span.
import path from "node:path";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "a",
  "span",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "em",
  "strong",
  "del",
  "hr",
  "br",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "input",
];

/**
 * Render Markdown to safe HTML. options.resolveLink(href) returns a docs anchor ("#doc/NAME") for an
 * authorized relative link, or null; external http(s)/mailto links are kept with rel=noreferrer.
 */
export function renderMarkdown(text, { resolveLink = () => null } = {}) {
  const raw = marked.parse(String(text ?? ""), { async: false, gfm: true });
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "rel", "title"],
      span: ["class", "title"],
      code: ["class"],
      th: ["align"],
      td: ["align"],
      input: ["type", "checked", "disabled"],
    },
    allowedClasses: { span: ["unresolved"], code: [/^language-[\w-]+$/] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "embed"],
    exclusiveFilter: (frame) => frame.tag === "input" && frame.attribs.type !== "checkbox",
    transformTags: {
      input: (tagName, attribs) => ({ tagName, attribs: { ...attribs, disabled: "" } }),
      a: (tagName, attribs) => {
        const href = attribs.href ?? "";
        if (/^(https?:|mailto:)/i.test(href)) {
          return { tagName: "a", attribs: { href, rel: "noreferrer noopener" } };
        }
        if (href.startsWith("#") && /^#[\w-]*$/.test(href))
          return { tagName: "a", attribs: { href } };
        const target = resolveLink(href);
        if (target) return { tagName: "a", attribs: { href: target } };
        return {
          tagName: "span",
          attribs: { class: "unresolved", title: `unresolved link: ${href}` },
        };
      },
    },
  });
}

/**
 * Link resolver for a document at `fromRel` in a checkout whose documents resolved to `entries`:
 * a relative link that lands on another document's source becomes "#doc/<NAME>".
 */
export function documentLinkResolver(fromRel, entries) {
  const bySource = new Map(
    entries.filter((e) => e.source).map((e) => [e.source.toLowerCase(), e.name]),
  );
  return (href) => {
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) return null;
    const clean = href.split("#")[0];
    if (!clean) return null;
    let decoded;
    try {
      decoded = decodeURIComponent(clean);
    } catch {
      return null;
    }
    const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), decoded));
    if (joined.startsWith("..")) return null;
    const name = bySource.get(joined.toLowerCase());
    return name ? `#doc/${name}` : null;
  };
}
