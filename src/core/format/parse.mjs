// Strict item grammar (ITEM-SPEC check groups 1, 2, 3 and 5). The only code that reads frontmatter.
// Returns every grammar problem found rather than stopping at the first, plus whatever fields could be
// read, so `check` can still run graph checks on a partly broken store and report everything at once.
import { parseContent } from "./content.mjs";
import { DATE_RE, ID_RE, KEYS, LIST_KEYS, RANK_RE, REQUIRED_KEYS, TOKEN_RE } from "./schema.mjs";

const BOM = [0xef, 0xbb, 0xbf];
const decoder = new TextDecoder("utf-8", { fatal: true });
const LINE_RE = /^([a-z_]+):(?: (.*))?$/;

const unreadable = { fields: null, title: null, rest: null, frontmatter: null, content: null };
const issue = (rule, code, message, line) => ({ rule, code, message, ...(line ? { line } : {}) });

/** Decode bytes strictly: no BOM, valid UTF-8. Returns {text} or {error}. */
export function decodeItemBytes(bytes) {
  if (typeof bytes === "string") return { text: bytes };
  if (bytes.length >= 3 && BOM.every((b, i) => bytes[i] === b)) {
    return { error: issue(3, "bom", "file starts with a UTF-8 byte-order mark") };
  }
  try {
    return { text: decoder.decode(bytes) };
  } catch {
    return { error: issue(3, "utf8", "file is not valid UTF-8") };
  }
}

/** Parse a flow list `[]` or `[a, b]`. Returns an array, or null when the form is wrong. */
export function parseList(value) {
  const m = /^\[(.*)\]$/.exec(value);
  if (!m) return null;
  if (m[1] === "") return [];
  const parts = m[1].split(", ");
  return parts.every((p) => ID_RE.test(p)) ? parts : null;
}

function checkValue(key, value, line, errors) {
  const bad = (what) =>
    errors.push(issue(3, "value", `${key}: ${what}: ${JSON.stringify(value)}`, line));
  if (LIST_KEYS.includes(key)) {
    const list = parseList(value);
    if (list === null) bad("expected a flow list of IDs like [] or [dk-1a2b3c4d, bl-0c0ffee1]");
    return list ?? [];
  }
  if (value === "") {
    if (REQUIRED_KEYS.includes(key)) bad("value is required");
    return "";
  }
  if (key === "created" || key === "since") {
    if (!DATE_RE.test(value)) bad("expected a date YYYY-MM-DD");
  } else if (!TOKEN_RE.test(value)) {
    bad("expected a plain token (letters, digits, . _ -)");
  } else if (key === "rank" && !RANK_RE.test(value)) {
    bad("rank must be lowercase letters a-z");
  } else if (key === "parent" && !ID_RE.test(value)) {
    bad("parent must be an item ID");
  }
  return value;
}

/**
 * Parse one item file.
 * Returns { fields, title, rest, frontmatter, content, errors } where `rest` is the exact text after the
 * closing fence line (H1, body and Notes, preserved byte for byte by the serializer), `frontmatter` the
 * exact text before it, and `content` the parsed content slices (format/content.mjs). fields is null
 * when no frontmatter could be located at all.
 */
export function parseItem(bytes) {
  const decoded = decodeItemBytes(bytes);
  if (decoded.error) return { ...unreadable, errors: [decoded.error] };
  const text = decoded.text;
  const errors = [];
  if (text.includes("\r")) errors.push(issue(3, "crlf", "CR characters (use LF line endings)"));

  const lines = text.split("\n");
  if (lines[0] !== "---") {
    errors.push(issue(1, "fence", "frontmatter fence `---` missing at line 1", 1));
    return { ...unreadable, errors };
  }
  const end = lines.indexOf("---", 1);
  if (end < 0) {
    errors.push(issue(1, "fence", "frontmatter is not closed by a `---` line"));
    return { ...unreadable, errors };
  }

  const fields = {};
  const order = [];
  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    if (/\t/.test(raw)) errors.push(issue(3, "tab", "tab character in frontmatter", lineNo));
    if (/ $/.test(raw)) errors.push(issue(3, "trailing-space", "trailing space", lineNo));
    const m = LINE_RE.exec(raw.replace(/[\t ]+$/, ""));
    if (!m) {
      errors.push(issue(3, "line", `not \`key: value\`: ${JSON.stringify(raw)}`, lineNo));
      continue;
    }
    const [, key, value = ""] = m;
    if (!KEYS.includes(key)) {
      errors.push(issue(2, "unknown-key", `unknown key \`${key}\``, lineNo));
      continue;
    }
    if (key in fields) {
      errors.push(issue(2, "duplicate-key", `duplicate key \`${key}\``, lineNo));
      continue;
    }
    order.push(key);
    fields[key] = checkValue(key, value, lineNo, errors);
  }
  const missing = KEYS.filter((k) => !(k in fields));
  if (missing.length) errors.push(issue(2, "missing-key", `missing key(s): ${missing.join(", ")}`));
  else if (order.join() !== KEYS.join()) {
    errors.push(issue(2, "key-order", `keys out of order: ${order.join(", ")}`));
  }

  const rest = lines.slice(end + 1).join("\n");
  const restLines = lines.slice(end + 1);
  const first = restLines.findIndex((l) => l.trim() !== "");
  const h1 = first >= 0 ? /^# (.*\S.*)$/.exec(restLines[first]) : null;
  if (!h1) {
    errors.push(
      issue(5, "title", "first non-blank line after the frontmatter must be an H1 `# Title`"),
    );
  }
  const content = parseContent(rest, end + 1);
  errors.push(...content.errors);
  const frontmatter = text.slice(0, text.length - rest.length);
  return { fields, title: h1 ? h1[1].trim() : null, rest, frontmatter, content, errors };
}
