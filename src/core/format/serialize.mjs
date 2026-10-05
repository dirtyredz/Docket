// Canonical item writing: the 12 keys in fixed order, then the untouched text after the fence.
// Content helpers (title, body, Notes) live in content.mjs.
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

/**
 * Full file text. `rest` is the exact text after the closing fence (H1, body, Notes). `frontmatter`,
 * when given, is the original frontmatter text, kept verbatim instead of the canonical form.
 */
export function serializeItem({ fields, rest, frontmatter }) {
  return (frontmatter ?? serializeFrontmatter(fields)) + rest;
}

/**
 * The one round-trip guard: serialize, reparse, and require the same fields and untouched `rest`.
 * A preserved `frontmatter` must therefore represent exactly the supplied fields: a caller cannot pair
 * preserved frontmatter with changed values. Returns the file text; a mismatch throws DOCKET_INTERNAL.
 */
export function serializeChecked(write) {
  const text = serializeItem(write);
  const reparsed = parseItem(text);
  if (!isDeepStrictEqual(reparsed.fields, write.fields) || reparsed.rest !== write.rest) {
    throw docketError(CODES.INTERNAL, `serializer round trip failed for ${write.fields.id}`);
  }
  return text;
}
