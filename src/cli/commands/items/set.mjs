// `set` command: change an item's status, priority, type, area, title or rank placement, or (alone,
// with --expect) replace its facts body from --body-file.
import { localDate } from "../../../core/identity/date.mjs";
import { setItem } from "../../../core/items/complete.mjs";
import { replaceBody } from "../../../core/items/content/body.mjs";
import * as claims from "../../../state/claims/store.mjs";
import { parseCommand, requirePositional, usageError } from "../../args.mjs";
import { readStrictInput } from "../../input.mjs";
import { bool, flagNamed, repoOf, str } from "./options.mjs";

const SCALAR_FLAGS = [
  "status",
  "priority",
  "type",
  "area",
  "title",
  "before",
  "after",
  "top",
  "bottom",
];

/** A deliberate facts rewrite: exactly the file's text after the H1; needs the revision it was based on. */
function setBody(args, io, id) {
  const clash = SCALAR_FLAGS.filter((k) => args[k] !== undefined);
  if (clash.length) throw usageError(`--body-file cannot be combined with --${clash.join(", --")}`);
  if (!args.expect) {
    throw usageError("--body-file needs --expect <revision> (from dk show --json)");
  }
  const body = readStrictInput(args["body-file"], "body");
  const data = replaceBody(repoOf(args, io), id, body, { expect: args.expect });
  return { data, text: data.noop ? `${id}: no change` : `${id}: body` };
}

export async function set(argv, io) {
  const args = parseCommand(argv, {
    positionals: 1,
    options: {
      status: str,
      priority: str,
      type: str,
      area: str,
      title: str,
      before: str,
      after: str,
      top: bool,
      bottom: bool,
      expect: str,
      "body-file": str,
    },
  });
  const id = requirePositional(args, "id");
  if (args["body-file"] !== undefined) return setBody(args, io, id);
  const placements = ["before", "after", "top", "bottom"].filter((k) => args[k] !== undefined);
  if (placements.length > 1) throw usageError(`use only one of --${placements.join(", --")}`);
  const changes = {
    status: args.status,
    priority: args.priority,
    type: args.type,
    area: args.area,
    title: args.title,
    placement: placements.length ? { [placements[0]]: args[placements[0]] } : undefined,
  };
  const ctx = repoOf(args, io);
  const { data, warnings } = flagNamed(() =>
    setItem(ctx, id, changes, { today: localDate(), expect: args.expect, claims }),
  );
  const text = data.noop ? `${id}: no change` : `${id}: ${data.changed.join(", ")}`;
  return { data, text, warnings };
}
