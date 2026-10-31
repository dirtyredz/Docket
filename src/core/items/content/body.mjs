// Body replacement: a deliberate rewrite of an item's facts. The body source after the H1 is replaced
// exactly as supplied; frontmatter, title and the Notes section are kept byte for byte. The caller must
// name the revision it read. `since`, rank and claims are untouched.
import { CODES, docketError } from "../../errors.mjs";
import { contentView } from "../../format/content.mjs";
import { withBody } from "../../format/content-edit.mjs";
import { assertRevision } from "../revisions.mjs";
import { editableContent, mutateStore, withWritten } from "../transaction.mjs";
import { contentWrite, verifyEdit } from "./write.mjs";

const invalid = (message) => docketError(CODES.INVALID, message);

/**
 * Plan a body replacement. body: the exact new source after the H1 (empty clears the facts).
 * options: {expect} (required). value: {id, noop, revision}.
 */
export function planBodyReplace({ byId }, id, body, { expect }) {
  if (expect === undefined || expect === null || expect === "") {
    throw docketError(
      CODES.USAGE,
      "replacing a body needs the revision it was based on (--expect)",
    );
  }
  const rec = editableContent(byId, id);
  assertRevision(rec, expect);
  if (typeof body !== "string") throw invalid("body must be a string");
  if (body.includes("\r")) throw invalid("body contains CR characters (use LF line endings)");
  const current = contentView(rec.rest, rec.content);
  if (body === current.bodySource) {
    return { writes: [], value: { id, noop: true, revision: rec.revision } };
  }
  const { titleEnd, bodyEnd, notes } = rec.content;
  const rest = withBody(rec.rest, rec.content, body);
  verifyEdit(
    id,
    rest,
    (after) =>
      rest.slice(0, titleEnd) === rec.rest.slice(0, titleEnd) &&
      rest.slice(after.bodyEnd) === rec.rest.slice(bodyEnd) &&
      after.notes.length === notes.length,
    () => "the body cannot contain a `## Notes` heading, note headers or an unclosed code fence",
  );
  return {
    writes: [contentWrite(rec, rest, expect)],
    value: { id, noop: false, revision: null },
  };
}

/** Replace a body. Returns {id, noop, revision} (the current revision on a no-op). */
export function replaceBody(ctx, id, body, { expect } = {}) {
  return withWritten(mutateStore(ctx, (s) => planBodyReplace(s, id, body, { expect })));
}
