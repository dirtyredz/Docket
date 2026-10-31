// The preserved-prefix content write shared by the body and note operations: the frontmatter is kept
// verbatim (never re-serialized), only `rest` changes, and every edited `rest` is reparsed and checked
// against what the edit promised to keep before it reaches the transaction.
import { CODES, docketError } from "../../errors.mjs";
import { parseContent } from "../../format/content.mjs";

/** The transaction write for a content edit of `rec`: original frontmatter text, new `rest`. */
export function contentWrite(rec, rest, expect) {
  return {
    id: rec.id,
    fields: rec.fields,
    frontmatter: rec.frontmatter,
    rest,
    expectedRevision: expect ?? rec.revision,
  };
}

/**
 * Reparse the edited `rest` of item `id` and require a clean grammar plus `isKept(after)` (the edit's
 * own preservation check). Returns the parsed content; otherwise throws DOCKET_INVALID ({id, errors})
 * with the message `${id}: ${explain(errors)}`.
 */
export function verifyEdit(id, rest, isKept, explain) {
  const after = parseContent(rest);
  if (after.errors.length === 0 && isKept(after)) return after;
  throw docketError(CODES.INVALID, `${id}: ${explain(after.errors)}`, { id, errors: after.errors });
}
