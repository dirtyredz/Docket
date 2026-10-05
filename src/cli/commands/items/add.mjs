// `add` command: create one item from flags, or many from a --batch file.
import { localDate } from "../../../core/identity/date.mjs";
import { planAdd } from "../../../core/items/add.mjs";
import { parseBatch, planAddBatch } from "../../../core/items/batch.mjs";
import { mutateStore } from "../../../core/items/transaction.mjs";
import { many, parseCommand, usageError } from "../../args.mjs";
import { readInput } from "../../input.mjs";
import { flagNamed, repeat, repoOf, str } from "./options.mjs";

function readBody(args) {
  if (args["body-file"] === undefined) return args.body ?? "";
  if (args.body !== undefined) throw usageError("use --body or --body-file, not both");
  return readInput(args["body-file"], "body");
}

const SINGLE_ONLY = ["type", "priority", "title", "body", "body-file", "area", "status", "parent"];
const SINGLE_LISTS = ["fixes", "blocked-by", "relates"];

const created = (item, revision) => ({
  id: item.id,
  file: `docs/items/${item.id}.md`,
  revision,
  ...item.fields,
  title: item.title,
});

async function addBatch(args, io) {
  const clash = [...SINGLE_ONLY, ...SINGLE_LISTS].filter((k) => args[k] !== undefined);
  if (clash.length) throw usageError(`--batch cannot be combined with --${clash.join(", --")}`);
  const inputs = parseBatch(readInput(args.batch, "batch"));
  const ctx = repoOf(args, io);
  const { value, written } = mutateStore(ctx, (s) =>
    planAddBatch(s, inputs, { today: localDate() }),
  );
  const items = value.map((v, i) => created(v, written[i].revision));
  return {
    data: { count: items.length, items },
    text: items.map((i) => `${i.id}  ${i.title}`).join("\n"),
  };
}

export async function add(argv, io) {
  const args = parseCommand(argv, {
    options: {
      type: str,
      priority: str,
      title: str,
      body: str,
      "body-file": str,
      area: str,
      status: str,
      parent: str,
      fixes: repeat,
      "blocked-by": repeat,
      relates: repeat,
      batch: str,
    },
  });
  if (args.batch !== undefined) return addBatch(args, io);
  for (const k of ["type", "priority", "title"]) if (!args[k]) throw usageError(`missing --${k}`);
  const input = {
    type: args.type,
    priority: args.priority,
    title: args.title,
    body: readBody(args),
    area: args.area,
    status: args.status,
    parent: args.parent,
    fixes: many(args.fixes),
    blocked_by: many(args["blocked-by"]),
    relates: many(args.relates),
  };
  const ctx = repoOf(args, io);
  const { value, written } = flagNamed(() =>
    mutateStore(ctx, (s) => planAdd(s, input, { today: localDate() })),
  );
  return {
    data: created(value, written[0].revision),
    text: `${value.id}  ${value.title}`,
  };
}
