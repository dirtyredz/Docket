// Local-date rules. Item dates are calendar dates in the writer's local time zone (ITEM-SPEC: `since`
// is a local date, not UTC), compared as strings because YYYY-MM-DD sorts chronologically.
import { DATE_RE } from "../format/schema.mjs";

const pad = (n) => String(n).padStart(2, "0");

/** Today's local date as YYYY-MM-DD. `now` is injectable for tests (a Date). */
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** True for a well-formed date that exists on the calendar (rejects 2026-02-30). */
export function isRealDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
