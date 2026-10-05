// Canonical item writing: the 12 keys in fixed order, then the untouched text after the fence.
import { isDeepStrictEqual } from "node:util";
import { CODES, docketError } from "../errors.mjs";
import { parseItem } from "./parse.mjs";
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

/**
 * The one round-trip guard: serialize, reparse, and require the same fields and untouched `rest`.
 * Returns the file text; a mismatch is a serializer bug and throws DOCKET_INTERNAL.
 */
export function serializeChecked({ fields, rest }) {
  const text = serializeItem({ fields, rest });
  const reparsed = parseItem(text);
  if (!isDeepStrictEqual(reparsed.fields, fields) || reparsed.rest !== rest) {
    throw docketError(CODES.INTERNAL, `serializer round trip failed for ${fields.id}`);
  }
  return text;
}

/** The `rest` for a new item: H1 title, blank line, optional body, single trailing newline. */
export function newItemRest(title, body = "") {
  const trimmed = body.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  return `# ${title}\n${trimmed ? `\n${trimmed}\n` : ""}`;
}

/** The body of an item: \`rest\` without its H1 title line and the blank lines after it (inverse of newItemRest). */
export function bodyOf(rest) {
  return rest.replace(/^\s*# .*\n?/, "").replace(/^\n+/, "");
}
