// Tiny DOM builder: h("tag", {attrs}, ...children). Text is always inserted as text nodes; the only
// HTML the UI inserts is server-sanitized Markdown (see views/documents.mjs and views/item-editor.mjs).

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in el && typeof value !== "string") el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Replace an element's children. */
export function replace(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/** "#/r/<repo>/<checkout>/board" style links. */
export const link = (href, text, attrs = {}) => h("a", { href, ...attrs }, text);
