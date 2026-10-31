// Item content edits: build or rewrite the text after the frontmatter (`rest`) from the slices
// parseContent (content.mjs) found. Every edit keeps the bytes it does not own: a title edit rewrites only
// the H1, a body edit only the facts slice, a note edit appends or flips one state token. Plus the title
// rule (cleanTitle) that add and set share. Never decodes or rewrites frontmatter.
import { CODES, docketError } from "../errors.mjs";
import { NOTES_HEADING, noteHeader } from "./content.mjs";

/**
 * Trim and validate a title: one non-empty line. Shared by add and set --title. Throws DOCKET_INVALID
 * (details: {field: "title"}).
 */
export function cleanTitle(raw) {
  const title = (raw ?? "").trim();
  if (!title || /[\r\n]/.test(title)) {
    throw docketError(CODES.INVALID, "title must be one non-empty line", { field: "title" });
  }
  return title;
}

/** The `rest` for a new item: H1 title, blank line, optional body, single trailing newline. */
export function newItemRest(title, body = "") {
  const trimmed = body.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  return `# ${title}\n${trimmed ? `\n${trimmed}\n` : ""}`;
}

/** rest with its H1 title line replaced; every other byte (body, Notes, line endings) is kept. */
export function withTitle(rest, title) {
  return rest.replace(/^(\s*)# .*/, (_, lead) => lead + "# " + title);
}

/** rest with the body source replaced; title prefix and Notes suffix are kept byte for byte. */
export function withBody(rest, content, body) {
  const prefix = rest.slice(0, content.titleEnd);
  const framing = body !== "" && prefix !== "" && !prefix.endsWith("\n") ? "\n" : "";
  return prefix + framing + body + rest.slice(content.bodyEnd);
}

/** The first free reference at or after `now` (a Date), advancing one millisecond per collision. */
export function allocateNoteRef(now, takenRefs) {
  const taken = new Set(takenRefs);
  let t = now.getTime();
  while (taken.has(new Date(t).toISOString())) t += 1;
  return new Date(t).toISOString();
}

/**
 * rest with a note appended: the whole existing text is kept as a prefix; only framing (a terminal LF
 * when missing, the `## Notes` heading on first use) and the new record are added.
 */
export function appendNote(rest, content, { ref, state = "open", author, text }) {
  let out = rest.endsWith("\n") || rest === "" ? rest : `${rest}\n`;
  if (!content.hasNotes) out += `\n${NOTES_HEADING}\n`;
  return `${out}\n${noteHeader({ ref, state, author })}\n\n${text}${text.endsWith("\n") ? "" : "\n"}`;
}

/** rest with one note's state token changed; every other byte is kept. */
export function withNoteState(rest, note, state) {
  return (
    rest.slice(0, note.headerStart) + noteHeader({ ...note, state }) + rest.slice(note.headerEnd)
  );
}
