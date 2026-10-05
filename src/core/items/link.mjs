// `link`: set or clear the scalar parent and add or remove list relations. `relates` is symmetric in
// queries but stored once: adding A relates B when B already relates A is a no-op, and removing it
// edits whichever file holds it.
import { LIST_KEYS } from "../format/schema.mjs";
import { assertRevision, assertRevisions } from "./revisions.mjs";
import { editableRecord } from "./transaction.mjs";

/**
 * Plan a link. change: {parent?, clearParent?, remove?, fixes?, blocked_by?, relates?} where the list
 * keys hold target IDs. Returns a transaction plan result; value.changes lists what actually changed.
 * options: {expect?: revision of `id` (checked even for a no-op), expectRevisions?: {id: revision}}.
 * With expectRevisions, every other item the edit rewrites (reverse-stored relates) must be listed and
 * current; all checks run before any write.
 */
export function planLink({ byId }, id, change, { expect, expectRevisions } = {}) {
  const rec = editableRecord(byId, id);
  assertRevision(rec, expect);
  const own = {
    ...rec.fields,
    fixes: [...rec.fields.fixes],
    blocked_by: [...rec.fields.blocked_by],
    relates: [...rec.fields.relates],
  };
  const others = new Map(); // id -> edited fields for reverse-stored relates removals
  const changes = [];
  const remove = Boolean(change.remove);

  if (change.clearParent && own.parent) {
    changes.push({ op: "clear", key: "parent", target: own.parent });
    own.parent = "";
  }
  if (change.parent !== undefined) {
    if (remove) {
      if (own.parent === change.parent) {
        own.parent = "";
        changes.push({ op: "remove", key: "parent", target: change.parent });
      }
    } else if (own.parent !== change.parent) {
      own.parent = change.parent;
      changes.push({ op: "set", key: "parent", target: change.parent });
    }
  }

  for (const key of LIST_KEYS) {
    for (const target of change[key] ?? []) {
      const reverse = key === "relates" ? byId.get(target)?.fields?.relates?.includes(id) : false;
      if (!remove) {
        if (own[key].includes(target) || reverse) continue;
        own[key].push(target);
        changes.push({ op: "add", key, target });
      } else if (own[key].includes(target)) {
        own[key] = own[key].filter((t) => t !== target);
        changes.push({ op: "remove", key, target });
      } else if (reverse) {
        const other = others.get(target) ?? { rec: editableRecord(byId, target) };
        other.fields ??= { ...other.rec.fields, relates: [...other.rec.fields.relates] };
        other.fields.relates = other.fields.relates.filter((t) => t !== id);
        others.set(target, other);
        changes.push({ op: "remove", key, target, storedOn: target });
      }
    }
  }

  assertRevisions(byId, [...others.keys()], expectRevisions);
  const writes = [];
  const ownChanged = changes.some((c) => !c.storedOn);
  if (ownChanged)
    writes.push({ id, fields: own, rest: rec.rest, expectedRevision: expect ?? rec.revision });
  for (const [otherId, { rec: orec, fields }] of others) {
    writes.push({ id: otherId, fields, rest: orec.rest, expectedRevision: orec.revision });
  }
  return { writes, value: { id, changes, fields: own } };
}
