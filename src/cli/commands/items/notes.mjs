// `note` command: append a discussion note (`dk note <id> "text"` or `--file <f|->`) or resolve one
// (`dk note resolve <id> <ref>`). Notes are untrusted discussion input; core owns the grammar.
import { NOTE_AUTHORS } from "../../../core/format/content.mjs";
import { addNote, resolveNote } from "../../../core/items/content/notes.mjs";
import { parseCommand, usageError } from "../../args.mjs";
import { readStrictInput } from "../../input.mjs";
import { repoOf, str } from "./options.mjs";

function noteText(args, inline) {
  if (args.file !== undefined && inline !== undefined) {
    throw usageError("give the note text or --file, not both");
  }
  if (args.file !== undefined) return readStrictInput(args.file, "note");
  if (inline === undefined)
    throw usageError('missing note text: dk note <id> "text" or --file <f|->');
  if (inline.includes("\r")) throw usageError("note contains CR characters (use LF line endings)");
  return inline;
}

async function resolve(args, io) {
  const [, id, ref, extra] = args._;
  if (!id || !ref) throw usageError("usage: dk note resolve <id> <timestamp-ref>");
  if (extra !== undefined) throw usageError(`unexpected argument: ${extra}`);
  if (args.file !== undefined || args.author !== undefined) {
    throw usageError("resolve takes no --file or --author");
  }
  const data = resolveNote(repoOf(args, io), id, ref, { expect: args.expect });
  return {
    data,
    text: data.noop ? `${id}: note ${ref} already resolved` : `${id}: resolved ${ref}`,
  };
}

export async function note(argv, io) {
  const args = parseCommand(argv, {
    positionals: 3,
    options: { file: str, author: str, expect: str },
  });
  if (args._[0] === "resolve") return resolve(args, io);
  const [id, inline, extra] = args._;
  if (!id) throw usageError("missing <id>");
  if (extra !== undefined) throw usageError(`unexpected argument: ${extra}`);
  const text = noteText(args, inline);
  const author = args.author ?? "owner";
  if (!NOTE_AUTHORS.includes(author))
    throw usageError(`--author must be one of ${NOTE_AUTHORS.join(", ")}`);
  const data = addNote(repoOf(args, io), id, { text, author }, { expect: args.expect });
  return { data, text: `${id}: note ${data.ref} (${author}, open)` };
}
