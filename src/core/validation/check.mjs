// Validation orchestration: parse every entry of a snapshot, run per-item, graph and advisory checks.
// Input is a snapshot (working tree or Git tree), never the index: check always reads the files.
import { parseItem } from "../format/parse.mjs";
import { checkEntryName, checkItemFields } from "./items.mjs";
import { checkRelations } from "./relations.mjs";
import { collectWarnings } from "./warnings.mjs";

/**
 * Parse snapshot entries. Every entry yields a record, malformed or not, so nothing is silently
 * omitted: {name, id, fields, title, rest, errors, revision}.
 */
export function parseEntries(entries) {
  return entries.map((entry) => {
    const nameIssue = checkEntryName(entry);
    const id = entry.name.replace(/\.md$/, "");
    if (nameIssue && !entry.isFile) {
      return { name: entry.name, id, fields: null, title: null, rest: null, errors: [nameIssue] };
    }
    const parsed = parseItem(entry.bytes);
    const errors = [...(nameIssue ? [nameIssue] : []), ...parsed.errors];
    if (parsed.fields) errors.push(...checkItemFields(parsed.fields, entry.name));
    errors.sort((a, b) => a.rule - b.rule);
    return { name: entry.name, id, ...parsed, errors, revision: entry.revision };
  });
}

/** Map<id, {fields, file}> of records whose frontmatter could be read and whose name is an item file. */
export function graphOf(records) {
  const items = new Map();
  for (const r of records) {
    if (r.fields && !r.errors.some((e) => e.rule === 1))
      items.set(r.id, { fields: r.fields, file: r.name });
  }
  return items;
}

/** All errors of parsed records: per-file issues plus graph integrity. [{file, rule, code, message}]. */
export function recordErrors(records) {
  const errors = [];
  for (const r of records) for (const e of r.errors) errors.push({ file: r.name, ...e });
  errors.push(...checkRelations(graphOf(records)));
  return errors;
}

/**
 * Validate a snapshot: {source, entries, configError?}.
 * options: {today, claimedIds}. Returns {ok, source, count, errors, warnings, records}.
 */
export function checkSnapshot(snapshot, { today, claimedIds = null } = {}) {
  const records = parseEntries(snapshot.entries);
  const errors = recordErrors(records);
  if (snapshot.configError) errors.push({ file: "docket.json", ...snapshot.configError });
  const warnings = collectWarnings(graphOf(records), { claimedIds, today });
  const byFile = (a, b) => a.file.localeCompare(b.file) || a.rule - b.rule;
  return {
    ok: errors.length === 0,
    source: snapshot.source,
    count: records.length,
    errors: errors.sort(byFile),
    warnings: warnings.sort(byFile),
    records,
  };
}
