// `link` command: add or remove parent, fixes, blocked-by and relates links.
import { planLink } from "../../../core/items/link.mjs";
import { mutateStore } from "../../../core/items/transaction.mjs";
import { many, parseCommand, requirePositional, usageError } from "../../args.mjs";
import { bool, repeat, repoOf, str } from "./options.mjs";

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
