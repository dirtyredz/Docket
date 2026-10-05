// Canonical item writing: the 12 keys in fixed order, then the untouched text after the fence.
import { KEYS, LIST_KEYS } from "./schema.mjs";

function line(key, value) {
  if (LIST_KEYS.includes(key)) return `${key}: [${(value ?? []).join(", ")}]`;
  return value === "" || value == null ? `${key}:` : `${key}: ${value}`;
}

/** Frontmatter block including both fences and the trailing newline. */
export function serializeFrontmatter(fields) {
  return `---\n${KEYS.map((k) => line(k, fields[k])).join("\n")}\n---\n`;
}

/** Full file text. `rest` is the exact text after the closing fence (H1 and body). */
export function serializeItem({ fields, rest }) {
  return serializeFrontmatter(fields) + rest;
}

/** The `rest` for a new item: H1 title, blank line, optional body, single trailing newline. */
export function newItemRest(title, body = "") {
  const trimmed = body.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  return `# ${title}\n${trimmed ? `\n${trimmed}\n` : ""}`;
}
