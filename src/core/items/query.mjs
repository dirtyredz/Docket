// Read-side operations shared by CLI and viewer: filtering, deterministic ordering, derived "blocked".
import { CODES, docketError } from "../errors.mjs";
import { CLOSED_STATUSES, ENUMS } from "../format/schema.mjs";

const PRIORITY_INDEX = Object.fromEntries(ENUMS.priority.map((p, i) => [p, i]));
const bytewise = (a = "", b = "") => (a < b ? -1 : a > b ? 1 : 0);

/** Priority, then bytewise rank, then ID: duplicate ranks still display deterministically. */
export function compareItems(a, b) {
  return (
    (PRIORITY_INDEX[a.fields.priority] ?? 9) - (PRIORITY_INDEX[b.fields.priority] ?? 9) ||
    bytewise(a.fields.rank, b.fields.rank) ||
    bytewise(a.id, b.id)
  );
}

/** Blocked is derived: any blocked_by target that is not done or dropped (or does not exist). */
export function isBlocked(fields, statusOf) {
  return (fields.blocked_by ?? []).some((t) => !CLOSED_STATUSES.includes(statusOf(t)));
}

/**
 * Filter and sort valid records. filters: {status[], type[], priority[], area, parent, blocked, all,
 * notes}. Without --all or an explicit status filter, done and dropped items are hidden. notes: "open"
 * keeps items with at least one open note (intersected with the other filters).
 * Returns {items: [summary], invalid: [{id, file, errors}]}; malformed files are never dropped silently.
 */
export function listItems(records, filters = {}) {
  const valid = records.filter((r) => r.fields && r.errors.length === 0);
  const statusById = new Map(valid.map((r) => [r.id, r.fields.status]));
  const statusOf = (id) => statusById.get(id);
  const statuses = filters.status?.length ? filters.status : filters.all ? null : ["todo", "wip"];
  const matches = valid.filter((r) => {
    const f = r.fields;
    if (statuses && !statuses.includes(f.status)) return false;
    if (filters.type?.length && !filters.type.includes(f.type)) return false;
    if (filters.priority?.length && !filters.priority.includes(f.priority)) return false;
    if (filters.area !== undefined && f.area !== filters.area) return false;
    if (filters.parent !== undefined && f.parent !== filters.parent) return false;
    if (filters.blocked && !isBlocked(f, statusOf)) return false;
    if (filters.notes === "open" && !(r.openNoteCount > 0)) return false;
    return true;
  });
  return {
    items: matches.sort(compareItems).map((r) => summarize(r, statusOf)),
    invalid: records
      .filter((r) => !r.fields || r.errors.length)
      .map((r) => ({ id: r.id, file: r.name, errors: r.errors })),
  };
}

/** Fields `countBy` accepts. */
export const COUNT_FIELDS = ["status", "type", "priority"];

/** Counts of summaries per value of `field` (one of COUNT_FIELDS): every enum value, zeros included. */
export function countBy(items, field) {
  if (!COUNT_FIELDS.includes(field)) {
    throw docketError(CODES.INVALID, `field must be one of ${COUNT_FIELDS.join(", ")}`);
  }
  const counts = Object.fromEntries(ENUMS[field].map((v) => [v, 0]));
  for (const item of items) counts[item[field]] += 1;
  return counts;
}

export function summarize(record, statusOf) {
  const { fields } = record;
  return {
    ...fields,
    title: record.title,
    blocked: isBlocked(fields, statusOf),
    openNoteCount: record.openNoteCount ?? 0,
  };
}

// Reverse relations: stored on the source item only, derived here.
/**
 * For `id`: children (parent = id), fixedBy (bugs whose fixes include id), blocks (items blocked by
 * id), relates (symmetric: stored on either side).
 */
export function reverseRelations(records, id) {
  const out = { children: [], fixedBy: [], blocks: [], relates: [] };
  for (const r of records) {
    const f = r.fields;
    if (!f || r.id === id) continue;
    if (f.parent === id) out.children.push(r.id);
    if (f.fixes?.includes(id)) out.fixedBy.push(r.id);
    if (f.blocked_by?.includes(id)) out.blocks.push(r.id);
    if (f.relates?.includes(id)) out.relates.push(r.id);
  }
  const own = records.find((r) => r.id === id)?.fields?.relates ?? [];
  out.relates = [...new Set([...own, ...out.relates])].sort();
  for (const k of ["children", "fixedBy", "blocks"]) out[k].sort();
  return out;
}
