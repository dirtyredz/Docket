// Per-item checks (ITEM-SPEC groups 1 and 4): filename, enums, id/filename equality, real dates,
// since >= created. Grammar (groups 2, 3, 5) is reported by the parser.
import { isRealDate } from "../identity/date.mjs";
import { ENUMS, FILE_RE, ID_RE } from "../format/schema.mjs";

const issue = (rule, code, message) => ({ rule, code, message });

/** Group 1 for a directory entry: name and kind. Returns an issue or null. */
export function checkEntryName(entry) {
  if (!entry.isFile) return issue(1, "not-a-file", "only item files belong in docs/items/");
  if (!FILE_RE.test(entry.name)) {
    return issue(1, "filename", "file name must be dk-<8hex>.md or bl-<8hex>.md");
  }
  return null;
}

/** Group 4 checks on parsed fields. `name` is the file name. */
export function checkItemFields(fields, name) {
  const errors = [];
  for (const [key, allowed] of Object.entries(ENUMS)) {
    const v = fields[key];
    if (v && !allowed.includes(v)) {
      errors.push(issue(4, "enum", `${key} must be one of ${allowed.join(" | ")}, got "${v}"`));
    }
  }
  if (fields.id) {
    if (!ID_RE.test(fields.id))
      errors.push(issue(4, "id", `id "${fields.id}" is not dk-/bl-<8hex>`));
    else if (`${fields.id}.md` !== name) {
      errors.push(issue(4, "id-filename", `id ${fields.id} does not match file name ${name}`));
    }
  }
  for (const key of ["created", "since"]) {
    const v = fields[key];
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isRealDate(v)) {
      errors.push(issue(4, "date", `${key} ${v} is not a real date`));
    }
  }
  if (isRealDate(fields.created) && isRealDate(fields.since) && fields.since < fields.created) {
    errors.push(
      issue(4, "since-before-created", `since ${fields.since} is before created ${fields.created}`),
    );
  }
  return errors;
}
