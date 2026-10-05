// Note lifecycle: append a discussion note, resolve one. Notes are untrusted discussion input, never
// facts: resolving copies nothing into the body. Appends keep the whole existing file as a prefix;
// resolve rewrites one state token. Both run through the shared transaction, revision-checked in the lock.
import { CODES, docketError } from "../../errors.mjs";
import {
  NOTE_AUTHORS,
  allocateNoteRef,
  appendNote,
  isNoteRef,
  parseContent,
  withNoteState,
} from "../../format/content.mjs";
import { assertRevision } from "../revisions.mjs";
import { editableContent, mutateStore } from "../transaction.mjs";

const invalid = (message, details) => docketError(CODES.INVALID, message, details);

const write = (rec, rest, expect) => ({
  id: rec.id,
  fields: rec.fields,
  frontmatter: rec.frontmatter,
  rest,
  expectedRevision: expect ?? rec.revision,
});

/** Validate note text: a string, LF only, not blank. Returned unchanged (never trimmed). */
export function cleanNoteText(text) {
  if (typeof text !== "string") throw invalid("note text must be a string");
  if (text.includes("\r")) throw invalid("note text contains CR characters (use LF line endings)");
  if (text.trim() === "") throw invalid("note text is empty");
  return text;
}

/**
 * Plan a note append. input: {text, author = "owner"}; options: {now (Date), expect?}.
 * The reference is allocated here, inside the lock: `now`, advanced a millisecond per collision.
 * value: {id, ref, author, state: "open"}.
 */
export function planNoteAppend({ byId }, id, input, { now, expect }) {
  const rec = editableContent(byId, id);
  assertRevision(rec, expect);
  const text = cleanNoteText(input.text);
  const author = input.author ?? "owner";
  if (!NOTE_AUTHORS.includes(author)) {
    throw invalid(`author must be one of ${NOTE_AUTHORS.join(", ")}`);
  }
  const ref = allocateNoteRef(
    now,
    rec.content.notes.map((n) => n.ref),
  );
  const rest = appendNote(rec.rest, rec.content, { ref, author, text });
  const after = parseContent(rest);
  const last = after.notes.at(-1);
  if (
    after.errors.length ||
    last?.ref !== ref ||
    after.notes.length !== rec.content.notes.length + 1
  ) {
    const why = after.errors.map((e) => e.message).join("; ");
    throw invalid(
      `${id}: the note cannot be added${why ? `: ${why}` : " (close any open code fence in the body first)"}; headings in note text must be fenced or escaped`,
      { id, errors: after.errors },
    );
  }
  return { writes: [write(rec, rest, expect)], value: { id, ref, author, state: "open" } };
}

/**
 * Plan a resolve. Only the selected header's state token changes. Already resolved is a no-op (the
 * revision is still asserted). value: {id, ref, state: "resolved", noop}.
 */
export function planNoteResolve({ byId }, id, ref, { expect }) {
  const rec = editableContent(byId, id);
  assertRevision(rec, expect);
  if (!isNoteRef(ref)) {
    throw docketError(
      CODES.USAGE,
      `note reference must be a timestamp like 2026-10-05T14:03:00.000Z`,
    );
  }
  const note = rec.content.notes.find((n) => n.ref === ref);
  if (!note) throw docketError(CODES.NOT_FOUND, `${id} has no note ${ref}`, { id, ref });
  const value = {
    id,
    ref,
    state: "resolved",
    noop: note.state === "resolved",
    revision: rec.revision,
  };
  if (value.noop) return { writes: [], value };
  return { writes: [write(rec, withNoteState(rec.rest, note, "resolved"), expect)], value };
}

const withRevision = ({ value, written }) => ({
  ...value,
  noop: written.length === 0,
  revision: written[0]?.revision ?? value.revision,
});

/** Append a note. Returns {id, ref, author, state, noop: false, revision}. */
export function addNote(ctx, id, input, { now = new Date(), expect } = {}) {
  return withRevision(mutateStore(ctx, (s) => planNoteAppend(s, id, input, { now, expect })));
}

/** Resolve a note. Returns {id, ref, state, noop, revision} (the current revision on a no-op). */
export function resolveNote(ctx, id, ref, { expect } = {}) {
  return withRevision(mutateStore(ctx, (s) => planNoteResolve(s, id, ref, { expect })));
}
