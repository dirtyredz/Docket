// `add --batch`: validate a whole JSON array of new items first, then plan them as one transaction.
// Nothing is written unless every entry is valid; ranks within a band follow array order.
import { CODES, docketError } from "../errors.mjs";
import { planAdd } from "./add.mjs";

const ALLOWED = ["type", "priority", "status", "title", "body", "area"];
const STRING_KEYS = ["type", "priority", "status", "title", "body", "area"];
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
      if (!ALLOWED.includes(k)) {
        throw invalid(`batch[${i}] has unknown key "${k}" (allowed: ${ALLOWED.join(", ")})`);
      }
    }
    for (const k of STRING_KEYS) {
      if (entry[k] !== undefined && typeof entry[k] !== "string") {
        throw invalid(`batch[${i}].${k} must be a string`);
      }
    }
  });
  return list;
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
      plan = planAdd({ records: view }, input, ctx);
    } catch (err) {
      err.message = `batch[${i}]: ${err.message}`;
      throw err;
    }
    const [write] = plan.writes;
    view.push({ id: write.id, fields: write.fields });
    writes.push(write);
    value.push(plan.value);
  });
  return { writes, value };
}
