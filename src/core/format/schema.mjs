// Item schema constants (docs/research/ITEM-SPEC.md, amended 2026-10-04). Fixed: no configurable vocabulary.
// Plus assertEnum, the one check of a caller-supplied enum value (add, batch and set share it).
import { CODES, docketError } from "../errors.mjs";

export const KEYS = Object.freeze([
  "id",
  "type",
  "created",
  "status",
  "since",
  "area",
  "priority",
  "rank",
  "parent",
  "fixes",
  "blocked_by",
  "relates",
]);

export const LIST_KEYS = Object.freeze(["fixes", "blocked_by", "relates"]);
/** Every relation key: the scalar parent, then the list relations. */
export const RELATION_KEYS = Object.freeze(["parent", ...LIST_KEYS]);
/** Keys holding a YYYY-MM-DD date (DATE_RE). */
export const DATE_KEYS = Object.freeze(["created", "since"]);
/** Keys that must carry a value (the rest may be empty: `key:`). */
export const REQUIRED_KEYS = Object.freeze([
  "id",
  "type",
  "created",
  "status",
  "since",
  "priority",
  "rank",
]);

export const ENUMS = Object.freeze({
  type: Object.freeze(["feature", "bug", "task", "idea"]),
  status: Object.freeze(["todo", "wip", "done", "dropped"]),
  priority: Object.freeze(["P0", "P1", "P2", "P3"]),
});

/**
 * Throw DOCKET_INVALID (details: {field}) unless `value` is one of ENUMS[field]; returns the value. The
 * message starts with the field name and the CLI maps details.field to its flag.
 */
export function assertEnum(field, value) {
  if (!ENUMS[field].includes(value)) {
    throw docketError(CODES.INVALID, `${field} must be one of ${ENUMS[field].join(", ")}`, {
      field,
    });
  }
  return value;
}

/** Statuses that end work: completion removes claims and stops counting as a blocker. */
export const CLOSED_STATUSES = Object.freeze(["done", "dropped"]);

/** `dk-` is minted for new items; `bl-` (a legacy ID prefix carried over from older backlogs) stays valid and immutable. */
export const ID_PREFIXES = Object.freeze(["dk", "bl"]);
export const NEW_ID_PREFIX = "dk";
const ID_SOURCE = `(${ID_PREFIXES.join("|")})-[0-9a-f]{8}`;
/** An item ID (either prefix); FILE_RE is the same ID as an item file name. */
export const ID_RE = new RegExp(`^${ID_SOURCE}$`);
export const FILE_RE = new RegExp(`^${ID_SOURCE}\\.md$`);
export const TOKEN_RE = /^[A-Za-z0-9._-]+$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const RANK_RE = /^[a-z]+$/;
