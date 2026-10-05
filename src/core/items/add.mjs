// `add`: mint a `dk-` ID, put the item at the end of its priority band, never overwrite a file.
import { CODES, docketError } from "../errors.mjs";
import { ENUMS } from "../format/schema.mjs";
import { newItemRest } from "../format/serialize.mjs";
import { allocateId } from "../identity/id.mjs";
import { rankAtEnd } from "../identity/rank.mjs";

const invalid = (message) => docketError(CODES.INVALID, message);
const unique = (list = []) => [...new Set(list)];

export function bandRanks(records, priority, exceptId = null) {
  return records
    .filter((r) => r.fields?.priority === priority && r.id !== exceptId && r.fields.rank)
    .map((r) => r.fields.rank);
}

/**
 * Plan an add. input: {type, priority, title, body?, area?, status?, parent?, fixes?, blocked_by?,
 * relates?}. ctx: {today, random?}. Returns a transaction plan result.
 */
export function planAdd({ records }, input, { today, random }) {
  if (!ENUMS.type.includes(input.type))
    throw invalid(`--type must be one of ${ENUMS.type.join(", ")}`);
  if (!ENUMS.priority.includes(input.priority)) {
    throw invalid(`--priority must be one of ${ENUMS.priority.join(", ")}`);
  }
  const title = (input.title ?? "").trim();
  if (!title || /[\r\n]/.test(title)) throw invalid("--title must be one non-empty line");
  const taken = new Set(records.map((r) => r.id));
  const id = allocateId({ taken: (x) => taken.has(x), random });
  const fields = {
    id,
    type: input.type,
    created: today,
    status: input.status ?? "todo",
    since: today,
    area: input.area ?? "",
    priority: input.priority,
    rank: rankAtEnd(bandRanks(records, input.priority)),
    parent: input.parent ?? "",
    fixes: unique(input.fixes),
    blocked_by: unique(input.blocked_by),
    relates: unique(input.relates),
  };
  const rest = newItemRest(title, input.body ?? "");
  return { writes: [{ id, fields, rest, expectedRevision: null }], value: { id, fields, title } };
}
