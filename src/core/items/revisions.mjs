// Revision preconditions shared by the set, link, body and note planners: the core-level guard over the
// caller's view (storage/revision.mjs computes revisions; storage/item-store re-checks at write time).
// They run inside the mutation lock, on the records just read, before anything is planned, so a stale
// caller is refused even when its change would be a no-op, and a multi-file relation edit is refused
// before its first write.
// Split: revision preconditions live here; record-editability checks (`editableRecord`,
// `editableContent`) live in transaction.mjs.
import { CODES, docketError } from "../errors.mjs";

const conflict = (id, expected, actual) =>
  docketError(CODES.CONFLICT, `${id} changed since it was read`, { id, expected, actual });
const usage = (message, details) => docketError(CODES.USAGE, message, details);
const isRevision = (v) => typeof v === "string" && v.length > 0;

/** Throw DOCKET_CONFLICT when `expected` is given and differs from the record's current revision. */
export function assertRevision(rec, expected) {
  if (expected === undefined || expected === null) return;
  if (rec.revision !== expected) throw conflict(rec.id, expected, rec.revision ?? null);
}

/**
 * The expected revision of the selected item `id` from `expect` and an optional revision map
 * (`expectRevisions`, {id: revision}). Without a map: `expect` (possibly undefined: the CLI's optional
 * behaviour). With a map: it must be an object holding a revision for `id`, and `expect`, when also
 * given, must agree with it. Request errors are DOCKET_USAGE.
 */
export function selectedExpectation(id, expect, expectRevisions) {
  if (expectRevisions === undefined || expectRevisions === null) return expect;
  if (typeof expectRevisions !== "object" || Array.isArray(expectRevisions)) {
    throw usage("expectRevisions must be an object of {id: revision}");
  }
  const own = expectRevisions[id];
  if (!Object.hasOwn(expectRevisions, id) || !isRevision(own)) {
    throw usage(`expected revision for ${id} is required`, { id });
  }
  if (expect !== undefined && expect !== null && expect !== own) {
    throw usage(`expect and expectRevisions disagree for ${id}`, { id });
  }
  return own;
}

/**
 * With a revision map, require a current entry for every id in `ids` (the other items an edit actually
 * rewrites): a missing or malformed entry is DOCKET_USAGE, a stale one (or an item that no longer
 * exists) DOCKET_CONFLICT. Entries for items the edit does not rewrite are ignored. Without a map,
 * nothing is asserted.
 */
export function assertRevisions(byId, ids, expectRevisions) {
  if (expectRevisions === undefined || expectRevisions === null) return;
  for (const id of ids) {
    if (!Object.hasOwn(expectRevisions, id) || !isRevision(expectRevisions[id])) {
      throw usage(`expected revision for ${id} is required`, { id });
    }
    const rec = byId.get(id);
    if (!rec) throw conflict(id, expectRevisions[id], null);
    assertRevision(rec, expectRevisions[id]);
  }
}
