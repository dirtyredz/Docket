// `add`: mint a `dk-` ID, put the item at the end of its priority band, never overwrite a file.
import { assertEnum } from "../format/schema.mjs";
import { cleanTitle, newItemRest } from "../format/content-edit.mjs";
import { allocateId } from "../identity/id.mjs";
import { rankAtEnd } from "../identity/rank.mjs";

const unique = (list = []) => [...new Set(list)];

/** Ranks of the valid items in `priority`, except `exceptId` (the item being moved). */
export function bandRanks(records, priority, exceptId = null) {
  return records
    .filter((r) => r.fields?.priority === priority && r.id !== exceptId && r.fields.rank)
    .map((r) => r.fields.rank);
}

/**
 * Plan an add. input: {type, priority, title, body?, area?, status?, parent?, fixes?, blocked_by?,
 * relates?}. Always dated today: created/since in input are ignored; historical dates are batch-only
 * policy (batch.mjs). ctx: {today, random?}. Returns a transaction plan result.
 */
export function planAdd(store, input, ctx) {
  const { write, value } = planAddOne(store, input, ctx, { created: ctx.today, since: ctx.today });
  return { writes: [write], value };
}

/**
 * Internal seam: plan one add with already-validated dates {created, since}. Only add.mjs (today) and
 * batch.mjs (after withDates) call it. Returns {write, value}; planAdd wraps it, batch collects many.
 */
export function planAddOne({ records }, input, { random }, dates) {
  assertEnum("type", input.type);
  assertEnum("priority", input.priority);
  if (input.status !== undefined) assertEnum("status", input.status);
  const title = cleanTitle(input.title);
  const taken = new Set(records.map((r) => r.id));
  const id = allocateId({ taken: (x) => taken.has(x), random });
  const fields = {
    id,
    type: input.type,
    created: dates.created,
    status: input.status ?? "todo",
    since: dates.since,
    area: input.area ?? "",
    priority: input.priority,
    rank: rankAtEnd(bandRanks(records, input.priority)),
    parent: input.parent ?? "",
    fixes: unique(input.fixes),
    blocked_by: unique(input.blocked_by),
    relates: unique(input.relates),
  };
  const rest = newItemRest(title, input.body ?? "");
  return { write: { id, fields, rest, expectedRevision: null }, value: { id, fields, title } };
}
