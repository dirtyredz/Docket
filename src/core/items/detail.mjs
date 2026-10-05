// The full read model of one item (`show`): fields, derived blocked, reverse relations, claim, body.
// Records come from the caller's index; claims are a dependency (`claims.readClaims`).
import { parseItem } from "../format/parse.mjs";
import { bodyOf } from "../format/serialize.mjs";
import { notFound } from "../errors.mjs";
import { readItemFile } from "../../storage/item-store.mjs";
import { isBlocked, reverseRelations } from "./query.mjs";

/**
 * Read item `id`. options: {records (index records), claims: {readClaims}}.
 * Returns {data, content}: data is the detail document, content the file text. Throws DOCKET_NOT_FOUND.
 */
export function readItem(ctx, id, { records, claims }) {
  const record = records.find((r) => r.id === id);
  const file = readItemFile(ctx, id);
  if (!record || !file) throw notFound(id);
  const content = file.bytes.toString("utf8");
  const statusOf = (x) => records.find((r) => r.id === x)?.fields?.status;
  const data = {
    ...(record.fields ?? {}),
    id,
    title: record.title,
    revision: file.revision,
    blocked: record.fields ? isBlocked(record.fields, statusOf) : false,
    reverse: reverseRelations(records, id),
    claim: claims.readClaims(ctx.commonDir).claims[id] ?? null,
    errors: record.errors,
    body: bodyOf(parseItem(content).rest ?? content),
  };
  return { data, content };
}
