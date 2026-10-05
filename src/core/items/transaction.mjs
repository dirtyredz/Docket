// The one mutation sequence shared by add, set and link (and the viewer later):
// lock the worktree -> load every item -> plan the change -> serialize and reparse each output ->
// reject any validation error the change introduces -> revision-checked atomic write.
import { isDeepStrictEqual } from "node:util";
import { parseItem } from "../format/parse.mjs";
import { serializeItem } from "../format/serialize.mjs";
import { parseEntries, recordErrors } from "../validation/check.mjs";
import { workingSnapshot } from "../../repository/snapshot.mjs";
import { lockPathFor, writeItemFile } from "../../storage/item-store.mjs";
import { withLock } from "../../storage/lock.mjs";

const keyOf = (e) => `${e.file}|${e.code}|${e.message}`;

/** Look up a record that can be edited (exists, frontmatter readable). Throws DOCKET_NOT_FOUND. */
export function editableRecord(byId, id) {
  const rec = byId.get(id);
  if (!rec)
    throw Object.assign(new Error(`no item ${id}`), { code: "DOCKET_NOT_FOUND", details: { id } });
  if (!rec.fields || rec.errors.some((e) => e.rule <= 3)) {
    throw Object.assign(new Error(`${id} is malformed; fix it by hand first (docket check)`), {
      code: "DOCKET_INVALID",
      details: { id, errors: rec.errors },
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
        const text = serializeItem(w);
        const reparsed = parseItem(text);
        if (!isDeepStrictEqual(reparsed.fields, w.fields) || reparsed.rest !== w.rest) {
          throw Object.assign(new Error(`serializer round trip failed for ${w.id}`), {
            code: "DOCKET_INTERNAL",
          });
        }
        const [record] = parseEntries([
          { name: `${w.id}.md`, isFile: true, bytes: Buffer.from(text) },
        ]);
        candidate.set(w.id, record);
        return { ...w, text };
      });

      const before = new Set(recordErrors(records).map(keyOf));
      const introduced = recordErrors([...candidate.values()]).filter((e) => !before.has(keyOf(e)));
      if (introduced.length) {
        throw Object.assign(
          new Error(
            `change rejected: ${introduced.map((e) => `${e.file}: ${e.message}`).join("; ")}`,
          ),
          { code: "DOCKET_INVALID", details: { errors: introduced } },
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
