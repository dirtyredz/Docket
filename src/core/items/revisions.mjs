// Revision preconditions shared by the set and link planners. They run inside the mutation lock, on the
// records just read, before anything is planned, so a stale caller is refused even when its change
// would be a no-op, and a multi-file relation edit is refused before its first write.
import { CODES, docketError } from "../errors.mjs";

const conflict = (id, expected, actual) =>
  docketError(CODES.CONFLICT, `${id} changed since it was read`, { id, expected, actual });

/** Throw DOCKET_CONFLICT when `expected` is given and differs from the record's current revision. */
export function assertRevision(rec, expected) {
  if (expected === undefined || expected === null) return;
  if (rec.revision !== expected) throw conflict(rec.id, expected, rec.revision ?? null);
}

/**
 * With an expected-revision map (`expectRevisions`, {id: revision}), require an entry for every id in
 * `ids` and check each against the current records. Without a map, nothing is asserted (the CLI's
 * optional behaviour). A missing entry is a request error (DOCKET_USAGE).
 */
export function assertRevisions(byId, ids, expectRevisions) {
  if (!expectRevisions) return;
  for (const id of ids) {
    if (!(id in expectRevisions)) {
      throw docketError(CODES.USAGE, `expected revision for ${id} is required`, { id });
    }
    const rec = byId.get(id);
    if (!rec) throw conflict(id, expectRevisions[id], null);
    assertRevision(rec, expectRevisions[id]);
  }
}
