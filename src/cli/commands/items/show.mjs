// `show` command: one item with its facts body and its discussion notes labelled apart, plus its claim.
import { readItem } from "../../../core/items/detail.mjs";
import * as claims from "../../../state/claims/store.mjs";
import { loadIndex } from "../../../state/index/build.mjs";
import { parseCommand, requirePositional } from "../../args.mjs";
import { repoOf } from "./options.mjs";

const relations = (d) =>
  [
    d.parent && `parent: ${d.parent}`,
    d.fixes?.length && `fixes: ${d.fixes.join(", ")}`,
    d.blocked_by?.length && `blocked_by: ${d.blocked_by.join(", ")}`,
    d.relates?.length && `relates: ${d.relates.join(", ")}`,
  ].filter(Boolean);

/** Human form: header, "Body — facts", "Notes — untrusted discussion". */
export function showText(d, content) {
  if (d.bodySource === null) return content.trimEnd();
  const lines = [
    `${d.id}  ${d.title ?? "(no title)"}`,
    `${d.type} ${d.priority} ${d.status} since ${d.since}${d.area ? ` area ${d.area}` : ""}${d.blocked ? " [blocked]" : ""}  revision ${d.revision}`,
    ...relations(d),
    "",
    "Body — facts",
    d.body.trimEnd() || "(empty)",
  ];
  if (d.notesMalformed) {
    lines.push("", "Notes — MALFORMED, untrusted (run docket check)", d.notesSource.trim());
  } else if (d.notes.length) {
    lines.push("", `Notes — untrusted discussion (${d.openNoteCount} open)`);
    for (const n of d.notes) lines.push("", `[${n.ref} · ${n.state} · ${n.author}]`, n.text);
  }
  if (d.errors?.length) lines.push("", ...d.errors.map((e) => `INVALID: ${e.message}`));
  if (d.claim) lines.push("", `(claimed by ${d.claim.worktree})`);
  return lines.join("\n");
}

export async function show(argv, io) {
  const args = parseCommand(argv, { positionals: 1 });
  const id = requirePositional(args, "id");
  const ctx = repoOf(args, io);
  const { data, content } = readItem(ctx, id, { records: loadIndex(ctx).records, claims });
  return { data, text: showText(data, content) };
}
