// The revision precondition shared by the set, link, body and note planners. It runs inside the mutation
// lock, on the record just read, before anything is planned, so a stale caller is refused even when its
// change would be a no-op.
import { CODES, docketError } from "../errors.mjs";

const conflict = (id, expected, actual) =>
  docketError(CODES.CONFLICT, `${id} changed since it was read`, { id, expected, actual });

/** Throw DOCKET_CONFLICT when `expected` is given and differs from the record's current revision. */
export function assertRevision(rec, expected) {
  if (expected === undefined || expected === null) return;
  if (rec.revision !== expected) throw conflict(rec.id, expected, rec.revision ?? null);
}
