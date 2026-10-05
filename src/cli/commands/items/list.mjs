// `list` command: filtered, limited, optionally counted item listing from the index.
import { ENUMS } from "../../../core/format/schema.mjs";
import { COUNT_FIELDS, countBy, listItems } from "../../../core/items/query.mjs";
import { loadIndex } from "../../../state/index/build.mjs";
import { many, parseCommand, usageError } from "../../args.mjs";
import { bool, checkEnum, repeat, repoOf, str } from "./options.mjs";

const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 500;

const row = (s, withRank) =>
  `${s.id}  ${s.priority} ${withRank ? `${s.rank.padEnd(4)} ` : ""}${s.status.padEnd(7)} ${s.type.padEnd(7)} ${s.blocked ? "[blocked] " : ""}${s.openNoteCount ? `notes:${s.openNoteCount} ` : ""}${s.title ?? ""}`;

export async function list(argv, io) {
  const args = parseCommand(argv, {
    options: {
      status: repeat,
      type: repeat,
      priority: repeat,
      area: str,
      parent: str,
      blocked: bool,
      all: bool,
      limit: str,
      rank: bool,
      "count-by": str,
      notes: str,
    },
  });
  const limit = args.limit === undefined ? LIST_LIMIT_DEFAULT : Number(args.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMIT_MAX) {
    throw usageError(`--limit must be an integer from 1 to ${LIST_LIMIT_MAX}`);
  }
  if (args.notes !== undefined && args.notes !== "open") {
    throw usageError("--notes must be open");
  }
  const filters = {
    status: checkEnum("status", many(args.status), ENUMS.status),
    type: checkEnum("type", many(args.type), ENUMS.type),
    priority: checkEnum("priority", many(args.priority), ENUMS.priority),
    area: args.area,
    parent: args.parent,
    blocked: args.blocked,
    all: args.all,
    notes: args.notes,
  };
  const { records } = loadIndex(repoOf(args, io));
  const { items, invalid } = listItems(records, filters);
  if (args["count-by"] !== undefined) {
    const field = args["count-by"];
    if (!COUNT_FIELDS.includes(field)) {
      throw usageError(`--count-by must be one of ${COUNT_FIELDS.join(", ")}`);
    }
    const counts = countBy(items, field);
    const lines = Object.entries(counts).map(([k, n]) => `${k.padEnd(8)} ${n}`);
    lines.push(`${"total".padEnd(8)} ${items.length}`);
    return {
      data: { countBy: field, counts, total: items.length, invalid },
      text: lines.join("\n"),
      warnings: invalid.map((b) => ({
        file: b.file,
        message: "malformed item (run docket check)",
      })),
    };
  }
  const shown = items.slice(0, limit);
  const data = {
    total: items.length,
    returned: shown.length,
    truncated: items.length > limit,
    items: shown,
    invalid,
  };
  const lines = shown.map((i) => row(i, Boolean(args.rank)));
  if (data.truncated) lines.push(`... ${items.length - limit} more (raise --limit or filter)`);
  for (const bad of invalid)
    lines.push(`${bad.file}  INVALID: ${bad.errors.map((e) => e.message).join("; ")}`);
  return {
    data,
    text: lines.join("\n") || "no matching items",
    warnings: invalid.map((b) => ({ file: b.file, message: "malformed item (run docket check)" })),
  };
}
