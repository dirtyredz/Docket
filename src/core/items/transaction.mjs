// The one mutation sequence shared by add, set and link (and the viewer later):
// lock the worktree -> load every item -> plan the change -> serialize and reparse each output ->
// reject any validation error the change introduces -> revision-checked atomic write.
import { CODES, docketError, notFound } from "../errors.mjs";
import { serializeChecked } from "../format/serialize.mjs";
import { parseEntries, recordErrors } from "../validation/check.mjs";
import { workingSnapshot } from "../../repository/snapshot.mjs";
import { lockPathFor, writeItemFile } from "../../storage/item-store.mjs";
import { withLock } from "../../storage/lock.mjs";

const keyOf = (e) => `${e.file}|${e.code}|${e.message}`;

/** Look up a record that can be edited (exists, frontmatter readable). Throws DOCKET_NOT_FOUND. */
export function editableRecord(byId, id) {
  const rec = byId.get(id);
  if (!rec) throw notFound(id);
  if (!rec.fields || rec.errors.some((e) => e.rule <= 3)) {
    throw docketError(CODES.INVALID, `${id} is malformed; fix it by hand first (docket check)`, {
      id,
      errors: rec.errors,
    });
  }
  return rec;
}

/**
 * Run a planned mutation. plan({records, byId}) returns {writes, value}; each write is
 * {id, fields, rest, expectedRevision} (expectedRevision null = must not exist yet).
 * Returns {value, written: [{id, revision}]}.
 */
export function mutateStore(ctx, plan, { lock } = {}) {
  return withLock(
    lockPathFor(ctx),
    () => {
      const records = parseEntries(workingSnapshot(ctx).entries);
      const byId = new Map(records.map((r) => [r.id, r]));
      const { writes, value } = plan({ records, byId });
      if (!writes.length) return { value, written: [] };

      const candidate = new Map(byId);
      const outputs = writes.map((w) => {
        const text = serializeChecked(w);
        const [record] = parseEntries([
          { name: `${w.id}.md`, isFile: true, bytes: Buffer.from(text) },
        ]);
        candidate.set(w.id, record);
        return { ...w, text };
      });

      const before = new Set(recordErrors(records).map(keyOf));
      const introduced = recordErrors([...candidate.values()]).filter((e) => !before.has(keyOf(e)));
      if (introduced.length) {
        throw docketError(
          CODES.INVALID,
          `change rejected: ${introduced.map((e) => `${e.file}: ${e.message}`).join("; ")}`,
          { errors: introduced },
        );
      }
      const written = outputs.map((o) => ({
        id: o.id,
        revision: writeItemFile(ctx, o.id, Buffer.from(o.text), {
          expectedRevision: o.expectedRevision,
        }),
      }));
      return { value, written };
    },
    lock,
  );
}
