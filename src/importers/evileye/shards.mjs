// Entry segmentation for one legacy EvilEye backlog file (a shard or the register), and the span map
// that accounts for every line of it. The segmentation contract is the EvilEye portal's
// (EvilEye tools/portal/src/backlog/parse.mjs, README "Markdown contract"), re-implemented for import:
// - Level-2 sections name a priority ("## P0" / "## P1" / "## P2") or the unprioritized wishlist.
// - An entry is a top-level list item ("- ", "* ", "1. ") inside such a section, with its indented
//   continuation lines and nested lists; or a level-3 heading whose body holds no top-level list.
// - An unindented line straight after an entry line continues it (lazy continuation) unless a blank
//   line intervenes or it opens with a bold lead (`**...`), which starts a separate text block.
import { lineSpan } from "../common/source-map.mjs";

export const INDEX_HEADING = "Ranking index";
export const ID_MARKER_RE = /[ \t]*<!--\s*(bl-[0-9a-f]{8})\s*-->/g;
const LIST_RE = /^(?:[-*+]|\d{1,4}[.)])[ \t]+/;
const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t#]*$/;
const FENCE_RE = /^[ \t]{0,3}(```|~~~)/;

/** Priority named by a level-2 section title: P0-P2, "U" for the wishlist, else null. */
export function sectionPriority(title) {
  const t = title.trim();
  const m = /^P([012])\b/.exec(t);
  if (m) return `P${m[1]}`;
  if (/wishlist|unprioritized/i.test(t)) return "U";
  return null;
}

/**
 * Scan lines into entries and headings. Returns {entries, headings, context} where context[i] is the
 * {h2, h3} in force at line i (h2: {title, priority, isIndex} or null).
 */
export function scanEntries(lines) {
  const entries = [];
  const headings = [];
  const context = [];
  let h2 = null;
  let h3 = null;
  let inFence = false;
  let current = null;
  let candidate = null; // level-3 heading that may itself be an entry
  let pendingBlank = false;

  const closeEntry = () => {
    if (current) entries.push(current);
    current = null;
  };
  const closeCandidate = () => {
    if (candidate && !candidate.hasList) {
      entries.push({
        kind: "heading",
        marker: "### ",
        startLine: candidate.line,
        endLine: candidate.lastLine,
        section: candidate.section,
        group: null,
      });
    }
    candidate = null;
  };

  lines.forEach((line, i) => {
    const t = line.text;
    if (FENCE_RE.test(t)) inFence = !inFence;
    const heading = !inFence && HEADING_RE.exec(t);
    const tracked = h2 && h2.priority && !h2.isIndex;
    context[i] = { h2, h3 };
    if (heading) {
      closeEntry();
      closeCandidate();
      pendingBlank = false;
      const level = heading[1].length;
      const title = heading[2].trim();
      if (level <= 2) {
        h2 =
          level === 2
            ? { title, priority: sectionPriority(title), isIndex: title.startsWith(INDEX_HEADING) }
            : null;
        h3 = null;
      } else {
        h3 = { title, line: i };
        if (level === 3 && h2?.priority && !h2.isIndex) {
          candidate = { line: i, lastLine: i, hasList: false, section: h2 };
        }
      }
      headings.push({ line: i, level, title });
      context[i] = { h2, h3 };
      return;
    }
    if (!tracked || (inFence && !current)) return;
    if (t.trim() === "") {
      pendingBlank = true;
      return;
    }
    const listMatch = LIST_RE.exec(t);
    if (listMatch && !inFence) {
      closeEntry();
      if (candidate && !candidate.hasList) candidate.hasList = true;
      current = {
        kind: "list",
        marker: listMatch[0],
        startLine: i,
        endLine: i,
        section: h2,
        group: h3 ? h3.title : null,
      };
      pendingBlank = false;
      return;
    }
    const indented = /^[ \t]/.test(t);
    const bareBoldLead = !indented && /^\*\*/.test(t);
    if (current && (indented || (!pendingBlank && !bareBoldLead) || inFence)) {
      current.endLine = i;
      pendingBlank = false;
      return;
    }
    closeEntry();
    pendingBlank = false;
    if (candidate && !candidate.hasList) candidate.lastLine = i;
  });
  closeEntry();
  closeCandidate();
  entries.sort((a, b) => a.startLine - b.startLine);
  return { entries, headings, context };
}

function proseDisposition(ctx) {
  if (!ctx.h2) {
    return {
      disposition: "wrapper",
      reason: "file preamble (title and conventions); stays in the retained source",
    };
  }
  if (ctx.h2.priority && !ctx.h2.isIndex) {
    return {
      disposition: "retained",
      reason: `group prose under "${ctx.h3?.title ?? ctx.h2.title}"; not carried into items, stays in the retained source`,
    };
  }
  return {
    disposition: "retained",
    reason: `register prose in "${ctx.h2.title}"; recorded with the register's hash, replaced by a navigation page at cutover`,
  };
}

function headingDisposition(h, ctx) {
  if (h.level === 1) return { disposition: "wrapper", reason: "file title" };
  if (h.level === 2 && ctx.h2?.priority) {
    return {
      disposition: "wrapper",
      reason: `priority section "${h.title}" (fallback priority for entries without a register row)`,
    };
  }
  if (h.level === 3 && ctx.h2?.priority && !ctx.h2.isIndex) {
    return {
      disposition: "wrapper",
      reason: `group heading "${h.title}" (recorded per item as source.group)`,
    };
  }
  return { disposition: "wrapper", reason: `section heading "${h.title}"` };
}

/**
 * Spans covering every line of the file, in order. entryKeys[n] names entry n's item ID (set by the
 * caller); rowLines maps a line index to {row: id, rowLine}. Kinds: entry, row, heading, table, blank,
 * prose. Dispositions: item, metadata (describes an item), wrapper, retained, blank.
 */
export function fileSpans(
  text,
  lines,
  scan,
  { entryKeys, rowLines = new Map(), tableLines = new Set() },
) {
  const owner = new Array(lines.length).fill(null);
  scan.entries.forEach((e, n) => {
    for (let i = e.startLine; i <= e.endLine; i++) owner[i] = { kind: "entry", n };
  });
  for (const h of scan.headings) if (!owner[h.line]) owner[h.line] = { kind: "heading", h };
  for (const [i, row] of rowLines) owner[i] = { kind: "row", row };
  for (const i of tableLines) if (!owner[i]) owner[i] = { kind: "table" };
  lines.forEach((l, i) => {
    if (owner[i]) return;
    owner[i] = l.text.trim() === "" ? { kind: "blank" } : { kind: "prose" };
  });

  const spans = [];
  let i = 0;
  while (i < lines.length) {
    const o = owner[i];
    let j = i;
    const same = (k) =>
      owner[k].kind === o.kind &&
      (o.kind === "entry"
        ? owner[k].n === o.n
        : (o.kind === "blank" || o.kind === "prose" || o.kind === "table") &&
          (o.kind !== "prose" || scan.context[k].h2 === scan.context[i].h2) &&
          (o.kind !== "prose" || scan.context[k].h3 === scan.context[i].h3));
    while (j + 1 < lines.length && same(j + 1)) j++;
    const ctx = scan.context[i];
    let props;
    if (o.kind === "entry") props = { kind: "entry", disposition: "item", item: entryKeys[o.n] };
    else if (o.kind === "row") {
      props = {
        kind: "row",
        disposition: "metadata",
        item: o.row.row,
        reason: `register row ${o.row.rowLine}: priority, rank and flags of ${o.row.row}`,
      };
    } else if (o.kind === "heading") props = { kind: "heading", ...headingDisposition(o.h, ctx) };
    else if (o.kind === "table")
      props = { kind: "table", disposition: "wrapper", reason: "ranking-index table header" };
    else if (o.kind === "blank") props = { kind: "blank", disposition: "blank" };
    else props = { kind: "prose", ...proseDisposition(ctx) };
    spans.push(lineSpan(text, lines, i, j, props));
    i = j + 1;
  }
  return spans;
}
