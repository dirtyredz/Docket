// `add --batch`: validate a whole JSON array of new items first, then plan them as one transaction.
// Nothing is written unless every entry is valid; ranks within a band follow array order.
import { CODES, docketError } from "../errors.mjs";
import { isRealDate } from "../identity/date.mjs";
import { planAddOne } from "./add.mjs";

// Every batch key is a string; these are also the only keys an entry may carry.
const KEYS = ["type", "priority", "status", "title", "body", "area", "created", "since"];
const invalid = (message) => docketError(CODES.INVALID, message);

/** Parse batch JSON text into add inputs. Throws DOCKET_INVALID naming the entry index. */
export function parseBatch(text) {
  let list;
  try {
    list = JSON.parse(text);
  } catch (err) {
    throw invalid(`batch is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(list)) throw invalid("batch must be a JSON array of items");
  if (!list.length) throw invalid("batch is empty");
  list.forEach((entry, i) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw invalid(`batch[${i}] must be an object`);
    }
    for (const k of Object.keys(entry)) {
      if (!KEYS.includes(k)) {
        throw invalid(`batch[${i}] has unknown key "${k}" (allowed: ${KEYS.join(", ")})`);
      }
    }
    for (const k of KEYS) {
      if (entry[k] !== undefined && typeof entry[k] !== "string") {
        throw invalid(`batch[${i}].${k} must be a string`);
      }
    }
  });
  return list;
}

/**
 * Resolve optional historical dates for a move-in entry: real calendar dates, not after today, since >=
 * created. Only one given means both are that date; none means today. Returns {created, since}.
 */
export function withDates(input, today) {
  const { created, since } = input;
  if (created === undefined && since === undefined) return { created: today, since: today };
  for (const [k, v] of [
    ["created", created],
    ["since", since],
  ]) {
    if (v === undefined) continue;
    if (!isRealDate(v)) throw invalid(`${k} must be a real YYYY-MM-DD date`);
    if (v > today) throw invalid(`${k} ${v} is in the future`);
  }
  const c = created ?? since;
  const s = since ?? created;
  if (s < c) throw invalid(`since ${s} is before created ${c}`);
  return { created: c, since: s };
}

/**
 * Plan every input in order against a growing view of the store so ranks and IDs never collide.
 * Returns a transaction plan: {writes, value: [{id, fields, title}]}. Throws on the first bad entry.
 */
export function planAddBatch({ records }, inputs, ctx) {
  const view = [...records];
  const writes = [];
  const value = [];
  inputs.forEach((input, i) => {
    let plan;
    try {
      plan = planAddOne({ records: view }, input, ctx, withDates(input, ctx.today));
    } catch (err) {
      err.message = `batch[${i}]: ${err.message}`;
      throw err;
    }
    view.push({ id: plan.write.id, fields: plan.write.fields });
    writes.push(plan.write);
    value.push(plan.value);
  });
  return { writes, value };
}
