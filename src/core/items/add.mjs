// `add`: mint a `dk-` ID, put the item at the end of its priority band, never overwrite a file.
import { CODES, docketError } from "../errors.mjs";
import { ENUMS } from "../format/schema.mjs";
import { newItemRest } from "../format/serialize.mjs";
import { allocateId } from "../identity/id.mjs";
import { rankAtEnd } from "../identity/rank.mjs";

const invalid = (message) => docketError(CODES.INVALID, message);
const unique = (list = []) => [...new Set(list)];

/** Trim and validate a title: one non-empty line. Shared by add and set --title. Throws DOCKET_INVALID. */
export function cleanTitle(raw) {
  const title = (raw ?? "").trim();
  if (!title || /[\r\n]/.test(title)) throw invalid("title must be one non-empty line");
  return title;
}

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
  if (!ENUMS.type.includes(input.type))
    throw invalid(`type must be one of ${ENUMS.type.join(", ")}`);
  if (!ENUMS.priority.includes(input.priority)) {
    throw invalid(`priority must be one of ${ENUMS.priority.join(", ")}`);
  }
  if (input.status !== undefined && !ENUMS.status.includes(input.status)) {
    throw invalid(`status must be one of ${ENUMS.status.join(", ")}`);
  }
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
