// Item content grammar: everything after the frontmatter. An H1 title, the facts body, and an optional
// final `## Notes` section of untrusted discussion notes (ITEM-SPEC check group 10). Exposes exact source
// slices so content edits rewrite only the bytes they own. Never decodes or rewrites frontmatter.

export const NOTES_HEADING = "## Notes";
export const NOTE_STATES = Object.freeze(["open", "resolved"]);
export const NOTE_AUTHORS = Object.freeze(["owner", "agent"]);
const SEP = " · ";

const REF_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEADER_RE = /^### (\S+) · (\S+) · (\S+)$/;
const HEADER_CANDIDATE_RE = /^###(?:[ \t]|$)/;
const SECTION_RE = /^#{1,2}(?:[ \t]|$)/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

const issue = (code, message, line) => ({ rule: 10, code, message, ...(line ? { line } : {}) });

/** True for a canonical UTC millisecond timestamp (a note reference), e.g. 2026-10-05T14:03:00.000Z. */
export function isNoteRef(value) {
  if (typeof value !== "string" || !REF_RE.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

/** The header line of a note (no LF). */
export const noteHeader = ({ ref, state, author }) => `### ${ref}${SEP}${state}${SEP}${author}`;

/** The first free reference at or after `now` (a Date), advancing one millisecond per collision. */
export function allocateNoteRef(now, takenRefs) {
  const taken = new Set(takenRefs);
  let t = now.getTime();
  while (taken.has(new Date(t).toISOString())) t += 1;
  return new Date(t).toISOString();
}

function* linesOf(text, from) {
  let start = from;
  while (start < text.length) {
    const lf = text.indexOf("\n", start);
    const end = lf < 0 ? text.length : lf;
    yield { start, end, next: lf < 0 ? text.length : lf + 1, text: text.slice(start, end) };
    start = lf < 0 ? text.length : lf + 1;
  }
}

/** Fence tracking (backtick and tilde fences, CommonMark-style). Returns the new fence state. */
function stepFence(fence, line) {
  if (fence) {
    const close = FENCE_CLOSE_RE.exec(line);
    const closes = close && close[1][0] === fence.char && close[1].length >= fence.length;
    return closes ? null : fence;
  }
  const open = FENCE_OPEN_RE.exec(line);
  if (!open) return null;
  const char = open[1][0];
  if (char === "`" && open[2].includes("`")) return null;
  return { char, length: open[1].length };
}

/** Parse a header line. Returns {ref, state, author} or an error message. */
function parseHeader(line) {
  const m = HEADER_RE.exec(line);
  if (!m) return { error: `note header must be \`### <timestamp> · <state> · <author>\`` };
  const [, ref, state, author] = m;
  if (!isNoteRef(ref)) return { error: `note timestamp ${ref} is not a canonical UTC timestamp` };
  if (!NOTE_STATES.includes(state)) return { error: `note state must be open or resolved` };
  if (!NOTE_AUTHORS.includes(author)) return { error: `note author must be owner or agent` };
  return { ref, state, author };
}

/**
 * Parse the text after the frontmatter (`rest`). lineOffset is the file line number of rest's first
 * line minus one (for error positions). Returns:
 * {titleEnd, bodyEnd, hasNotes, notes, errors, bodyFenceOpen} where rest.slice(0, titleEnd) is the
 * title prefix (through the H1 line's LF), rest.slice(titleEnd, bodyEnd) the exact body source and
 * rest.slice(bodyEnd) the Notes suffix (it starts with the LF that introduces `## Notes`). Each note is
 * {ref, state, author, headerStart, headerEnd, payloadStart, payloadEnd}; its payload excludes the LF
 * that introduces the next header (framing, not payload).
 */
export function parseContent(rest, lineOffset = 0) {
  const errors = [];
  const lineNo = (start) => lineOffset + rest.slice(0, start).split("\n").length;
  let titleEnd = 0;
  for (const l of linesOf(rest, 0)) {
    if (l.text.trim() === "") continue;
    if (/^# (.*\S.*)$/.test(l.text)) titleEnd = l.next;
    break;
  }

  let fence = null;
  let heading = null;
  for (const l of linesOf(rest, titleEnd)) {
    if (!fence && l.text === NOTES_HEADING) {
      heading = l;
      break;
    }
    if (!fence && HEADER_RE.test(l.text)) {
      errors.push(
        issue("note-outside", "note header outside the `## Notes` section", lineNo(l.start)),
      );
    }
    fence = stepFence(fence, l.text);
  }
  const content = { titleEnd, bodyEnd: rest.length, hasNotes: false, notes: [], errors };
  if (!heading) return { ...content, bodyFenceOpen: Boolean(fence) };

  const bodyEnd = heading.start > titleEnd ? heading.start - 1 : heading.start;
  const notes = [];
  const refs = new Set();
  fence = null;
  for (const l of linesOf(rest, heading.next)) {
    const wasFenced = Boolean(fence);
    fence = stepFence(fence, l.text);
    if (wasFenced || fence) continue;
    if (HEADER_CANDIDATE_RE.test(l.text)) {
      const header = parseHeader(l.text);
      if (header.error) {
        errors.push(issue("note-header", header.error, lineNo(l.start)));
        continue;
      }
      if (refs.has(header.ref)) {
        errors.push(issue("note-duplicate", `duplicate note ${header.ref}`, lineNo(l.start)));
      }
      refs.add(header.ref);
      notes.push({ ...header, headerStart: l.start, headerEnd: l.end, payloadStart: l.next });
    } else if (SECTION_RE.test(l.text)) {
      errors.push(
        issue("notes-section", "no heading above `###` may follow `## Notes`", lineNo(l.start)),
      );
    } else if (!notes.length && l.text.trim() !== "") {
      errors.push(
        issue("notes-stray", "text before the first note in `## Notes`", lineNo(l.start)),
      );
    }
  }
  if (fence) errors.push(issue("notes-fence", "unclosed code fence in `## Notes`"));
  notes.forEach((n, i) => {
    const next = notes[i + 1];
    n.payloadEnd = next ? Math.max(n.payloadStart, next.headerStart - 1) : rest.length;
    if (rest.slice(n.payloadStart, n.payloadEnd).trim() === "") {
      errors.push(issue("note-empty", `note ${n.ref} has no text`, lineNo(n.headerStart)));
    }
  });
  return { ...content, bodyEnd, hasNotes: true, notes, bodyFenceOpen: false };
}

/** Display text of a payload: the exact source without its framing blank lines. */
const displayText = (source) => source.replace(/^\n+/, "").replace(/\n+$/, "");

/**
 * The read model of item content: {bodySource, body, notes: [{ref, state, author, source, text}],
 * openNoteCount}. body is the display form (leading blank lines dropped, as bodyOf always did).
 */
export function contentView(rest, content) {
  const bodySource = rest.slice(content.titleEnd, content.bodyEnd);
  const notes = content.notes.map((n) => {
    const source = rest.slice(n.payloadStart, n.payloadEnd);
    return { ref: n.ref, state: n.state, author: n.author, source, text: displayText(source) };
  });
  return {
    bodySource,
    body: bodySource.replace(/^\n+/, ""),
    notes,
    openNoteCount: notes.filter((n) => n.state === "open").length,
  };
}

export const openNoteCount = (content) =>
  content ? content.notes.filter((n) => n.state === "open").length : 0;

/** The `rest` for a new item: H1 title, blank line, optional body, single trailing newline. */
export function newItemRest(title, body = "") {
  const trimmed = body.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  return `# ${title}\n${trimmed ? `\n${trimmed}\n` : ""}`;
}

/** rest with its H1 title line replaced; every other byte (body, Notes, line endings) is kept. */
export function withTitle(rest, title) {
  return rest.replace(/^(\s*)# .*/, (_, lead) => lead + "# " + title);
}

/** The display body of an item without Notes (inverse of newItemRest for items without Notes). */
export function bodyOf(rest) {
  return contentView(rest, parseContent(rest)).body;
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

/** rest with the body source replaced; title prefix and Notes suffix are kept byte for byte. */
export function withBody(rest, content, body) {
  const prefix = rest.slice(0, content.titleEnd);
  const framing = body !== "" && prefix !== "" && !prefix.endsWith("\n") ? "\n" : "";
  return prefix + framing + body + rest.slice(content.bodyEnd);
}
