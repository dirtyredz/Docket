// The legacy register's ranking index (docs/BACKLOG.md "## Ranking index"): one table row per ranked
// entry. Row order within a priority is the rank; the row is authoritative for priority and flags.
// The "Entry" cell is a truncated copy of the entry's title (derived, never carried).
import { INDEX_HEADING } from "./shards.mjs";

const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t#]*$/;
const ROW_ID_RE = /^bl-[0-9a-f]{8}$/;

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (t[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** "P0".."P2", "U" (unprioritized: empty, "-", "—"), or null when unreadable. */
export function parsePriorityCell(cell) {
  const c = cell.replace(/[`*_]/g, "").trim();
  if (/^P[012]$/i.test(c)) return c.toUpperCase();
  if (c === "" || c === "-" || c === "—" || /^u(nprioritized)?$/i.test(c)) return "U";
  return null;
}

/** Known flags in a cell: {flags: ["research needed", "ask me more"], unknown}. */
export function parseFlagsCell(cell) {
  const c = cell.toLowerCase();
  const flags = [];
  if (/research/.test(c)) flags.push("research needed");
  if (/\bask\b/.test(c)) flags.push("ask me more");
  const rest = c.replace(/research needed|research|ask me more|ask/g, "").replace(/[;,\s—-]/g, "");
  return { flags, unknown: rest.length > 0 };
}

/**
 * Read the ranking index. Returns {found, rows, rowLines, tableLines, problems}. rows are in file
 * order: {line (1-based), lineIndex, id, priority, flags, entry, problems}.
 */
export function parseRegisterIndex(lines) {
  const out = { found: false, rows: [], rowLines: new Map(), tableLines: new Set(), problems: [] };
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const h = HEADING_RE.exec(lines[i].text);
    if (!h) continue;
    if (start < 0 && h[1].length === 2 && h[2].trim().startsWith(INDEX_HEADING)) start = i;
    else if (start >= 0 && h[1].length <= 2) {
      end = i;
      break;
    }
  }
  if (start < 0) return out;
  out.found = true;
  let header = -1;
  let cols = null;
  for (let i = start + 1; i < end; i++) {
    if (!lines[i].text.trim().startsWith("|")) continue;
    const cells = splitRow(lines[i].text).map((c) => c.toLowerCase());
    if (cells.includes("id") && cells.includes("priority")) {
      header = i;
      cols = {
        id: cells.indexOf("id"),
        priority: cells.indexOf("priority"),
        flags: cells.indexOf("flags"),
        entry: cells.indexOf("entry"),
      };
      break;
    }
  }
  if (header < 0) {
    out.problems.push(`ranking index at line ${start + 1} has no "| ID | Priority | ... |" table`);
    return out;
  }
  out.tableLines.add(header);
  out.tableLines.add(header + 1);
  for (let i = header + 2; i < end; i++) {
    if (!lines[i].text.trim().startsWith("|")) break;
    const cells = splitRow(lines[i].text);
    const id = (cells[cols.id] ?? "").replace(/`/g, "").trim();
    const flags =
      cols.flags >= 0 ? parseFlagsCell(cells[cols.flags] ?? "") : { flags: [], unknown: false };
    const row = {
      line: i + 1,
      lineIndex: i,
      id,
      priority: parsePriorityCell(cells[cols.priority] ?? ""),
      flags: flags.flags,
      entry: cols.entry >= 0 ? (cells[cols.entry] ?? "") : "",
      problems: [],
    };
    if (flags.unknown) row.problems.push(`unrecognised flag text "${cells[cols.flags]}"`);
    if (!ROW_ID_RE.test(id)) row.problems.push(`"${id}" is not a bl- ID`);
    if (!row.priority)
      row.problems.push(`priority "${cells[cols.priority]}" is not P0, P1, P2 or "—"`);
    out.rows.push(row);
    out.rowLines.set(i, { row: row.id, rowLine: row.line });
  }
  return out;
}
