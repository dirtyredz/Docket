// The full read model of one item (`show`, the viewer's detail): fields, derived blocked, reverse
// relations, claim, facts body and discussion notes. The selected item is parsed from freshly read bytes,
// so fields, title, body, notes, errors and revision always describe the same file; the caller's index records supply only the
// surrounding items (for reverse relations and blocker statuses). Claims are a dependency
// (`claims.readClaims`).
import { contentView } from "../format/content.mjs";
import { notFound } from "../errors.mjs";
import { parseEntries } from "../validation/check.mjs";
import { readItemFile } from "../../storage/item-store.mjs";
import { isBlocked, reverseRelations } from "./query.mjs";

/**
 * Read item `id`. options: {records (index records), claims: {readClaims}}.
 * Returns {data, content}: data is the detail document, content the file text. Throws DOCKET_NOT_FOUND
 * when the file does not exist (whatever the index says).
 */
export function readItem(ctx, id, { records, claims }) {
  const file = readItemFile(ctx, id);
  if (!file) throw notFound(id);
  const content = file.bytes.toString("utf8");
  const [fresh] = parseEntries([
    { name: `${id}.md`, isFile: true, bytes: file.bytes, revision: file.revision },
  ]);
  const surrounding = [...records.filter((r) => r.id !== id), fresh];
  const statusOf = (x) => surrounding.find((r) => r.id === x)?.fields?.status;
  const data = {
    ...(fresh.fields ?? {}),
    id,
    title: fresh.title,
    revision: file.revision,
    blocked: fresh.fields ? isBlocked(fresh.fields, statusOf) : false,
    reverse: reverseRelations(surrounding, id),
    claim: claims.readClaims(ctx.commonDir).claims[id] ?? null,
    errors: fresh.errors,
    ...contentModel(fresh, content),
  };
  return { data, content };
}

/**
 * Facts and notes kept apart: {body, bodySource, notes, openNoteCount, notesMalformed, notesSource}.
 * body is display text, bodySource the exact editable source. Malformed Notes are never folded into
 * the facts: notesMalformed is set and notesSource carries the raw, untrusted section.
 */
function contentModel(fresh, content) {
  if (fresh.rest == null || !fresh.content) {
    const none = { bodySource: null, notes: [], openNoteCount: 0 };
    return { body: content, ...none, notesMalformed: false, notesSource: null };
  }
  const view = contentView(fresh.rest, fresh.content);
  const malformed = fresh.content.errors.length > 0;
  return {
    ...view,
    notesMalformed: malformed,
    notesSource: malformed ? fresh.rest.slice(fresh.content.bodyEnd) : null,
  };
}

/**
 * Fresh revisions of `id` and of every item that stores a `relates` edge to it (reverse-stored
 * relations a removal must rewrite). {[id]: revision}; items that no longer exist are omitted.
 */
export function relationRevisions(ctx, id, holders) {
  const out = {};
  for (const x of [id, ...holders]) {
    const file = readItemFile(ctx, x);
    if (file) out[x] = file.revision;
  }
  return out;
}
