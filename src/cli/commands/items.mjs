// Item commands: add, set, link, list, show, index. Thin adapters over core/items and the index.
import fs from "node:fs";
import { ENUMS } from "../../core/format/schema.mjs";
import { localDate } from "../../core/identity/date.mjs";
import { planAdd } from "../../core/items/add.mjs";
import { setItem } from "../../core/items/complete.mjs";
import { readItem } from "../../core/items/detail.mjs";
import { planLink } from "../../core/items/link.mjs";
import { listItems } from "../../core/items/query.mjs";
import { mutateStore } from "../../core/items/transaction.mjs";
import { resolveRepo } from "../../repository/context.mjs";
import * as claims from "../../state/claims/store.mjs";
import { loadIndex } from "../../state/index/build.mjs";
import { many, parseCommand, requirePositional, usageError } from "../args.mjs";

const str = { type: "string" };
const repeat = { type: "string", multiple: true };
const bool = { type: "boolean" };
const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 500;

const repoOf = (args, io) => resolveRepo(args.repo ?? io.cwd);

function checkEnum(name, values, allowed) {
  for (const v of values) {
    if (!allowed.includes(v)) throw usageError(`--${name} must be one of ${allowed.join(", ")}`);
  }
  return values;
}

function readBody(args) {
  if (args["body-file"] === undefined) return args.body ?? "";
  if (args.body !== undefined) throw usageError("use --body or --body-file, not both");
  return fs.readFileSync(args["body-file"] === "-" ? 0 : args["body-file"], "utf8");
}

const row = (s) =>
  `${s.id}  ${s.priority} ${s.rank.padEnd(4)} ${s.status.padEnd(7)} ${s.type.padEnd(7)} ${s.blocked ? "[blocked] " : ""}${s.title ?? ""}`;

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
    },
  });
  for (const k of ["type", "priority", "title"]) if (!args[k]) throw usageError(`missing --${k}`);
  checkEnum("type", [args.type], ENUMS.type);
  checkEnum("priority", [args.priority], ENUMS.priority);
  if (args.status) checkEnum("status", [args.status], ENUMS.status);
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
  const { value, written } = mutateStore(ctx, (s) => planAdd(s, input, { today: localDate() }));
  return {
    data: {
      id: value.id,
      file: `docs/items/${value.id}.md`,
      revision: written[0].revision,
      ...value.fields,
      title: value.title,
    },
    text: value.id,
  };
}

export async function set(argv, io) {
  const args = parseCommand(argv, {
    positionals: 1,
    options: {
      status: str,
      priority: str,
      type: str,
      area: str,
      before: str,
      after: str,
      top: bool,
      bottom: bool,
      expect: str,
    },
  });
  const id = requirePositional(args, "id");
  const placements = ["before", "after", "top", "bottom"].filter((k) => args[k] !== undefined);
  if (placements.length > 1) throw usageError(`use only one of --${placements.join(", --")}`);
  if (args.status) checkEnum("status", [args.status], ENUMS.status);
  if (args.priority) checkEnum("priority", [args.priority], ENUMS.priority);
  if (args.type) checkEnum("type", [args.type], ENUMS.type);
  const changes = {
    status: args.status,
    priority: args.priority,
    type: args.type,
    area: args.area,
    placement: placements.length ? { [placements[0]]: args[placements[0]] } : undefined,
  };
  const { data, warnings } = setItem(repoOf(args, io), id, changes, {
    today: localDate(),
    expect: args.expect,
    claims,
  });
  const text = data.noop ? `${id}: no change` : `${id}: ${data.changed.join(", ")}`;
  return { data, text, warnings };
}

export async function link(argv, io) {
  const args = parseCommand(argv, {
    positionals: 1,
    options: {
      parent: str,
      "clear-parent": bool,
      remove: bool,
      fixes: repeat,
      "blocked-by": repeat,
      relates: repeat,
      expect: str,
    },
  });
  const id = requirePositional(args, "id");
  const change = {
    parent: args.parent,
    clearParent: args["clear-parent"],
    remove: args.remove,
    fixes: many(args.fixes),
    blocked_by: many(args["blocked-by"]),
    relates: many(args.relates),
  };
  if (
    change.parent === undefined &&
    !change.clearParent &&
    !change.fixes.length &&
    !change.blocked_by.length &&
    !change.relates.length
  ) {
    throw usageError(
      "nothing to link: give --parent, --clear-parent, --fixes, --blocked-by or --relates",
    );
  }
  const ctx = repoOf(args, io);
  const { value, written } = mutateStore(ctx, (s) =>
    planLink(s, id, change, { expect: args.expect }),
  );
  const text = value.changes.length
    ? value.changes
        .map(
          (c) =>
            `${id}: ${c.op} ${c.key} ${c.target}${c.storedOn ? ` (stored on ${c.storedOn})` : ""}`,
        )
        .join("\n")
    : `${id}: no change`;
  return { data: { ...value, written }, text };
}

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
    },
  });
  const limit = args.limit === undefined ? LIST_LIMIT_DEFAULT : Number(args.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMIT_MAX) {
    throw usageError(`--limit must be an integer from 1 to ${LIST_LIMIT_MAX}`);
  }
  const filters = {
    status: checkEnum("status", many(args.status), ENUMS.status),
    type: checkEnum("type", many(args.type), ENUMS.type),
    priority: checkEnum("priority", many(args.priority), ENUMS.priority),
    area: args.area,
    parent: args.parent,
    blocked: args.blocked,
    all: args.all,
  };
  const { records } = loadIndex(repoOf(args, io));
  const { items, invalid } = listItems(records, filters);
  const shown = items.slice(0, limit);
  const data = {
    total: items.length,
    returned: shown.length,
    truncated: items.length > limit,
    items: shown,
    invalid,
  };
  const lines = shown.map(row);
  if (data.truncated) lines.push(`... ${items.length - limit} more (raise --limit or filter)`);
  for (const bad of invalid)
    lines.push(`${bad.file}  INVALID: ${bad.errors.map((e) => e.message).join("; ")}`);
  return {
    data,
    text: lines.join("\n") || "no matching items",
    warnings: invalid.map((b) => ({ file: b.file, message: "malformed item (run docket check)" })),
  };
}

export async function show(argv, io) {
  const args = parseCommand(argv, { positionals: 1 });
  const id = requirePositional(args, "id");
  const ctx = repoOf(args, io);
  const { data, content } = readItem(ctx, id, { records: loadIndex(ctx).records, claims });
  const claimNote = data.claim
    ? `

(claimed by ${data.claim.worktree})`
    : "";
  return { data, text: content.trimEnd() + claimNote };
}

export async function index(argv, io) {
  const args = parseCommand(argv, { options: { rebuild: bool } });
  const { stats } = loadIndex(repoOf(args, io), { rebuild: Boolean(args.rebuild) });
  return {
    data: stats,
    text: `index: ${stats.total} file(s), ${stats.parsed} parsed, ${stats.reused} reused, ${stats.removed} removed (cache ${stats.cache})`,
  };
}
