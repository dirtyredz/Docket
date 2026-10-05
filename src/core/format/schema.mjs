// Item schema constants (docs/research/ITEM-SPEC.md, amended 2026-10-04). Fixed: no configurable vocabulary.

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
export const RELATION_KEYS = Object.freeze(["parent", ...LIST_KEYS]);
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

/** Statuses that end work: completion removes claims and stops counting as a blocker. */
export const CLOSED_STATUSES = Object.freeze(["done", "dropped"]);

/** `dk-` is minted for new items; `bl-` (a legacy ID prefix carried over from older backlogs) stays valid and immutable. */
export const ID_PREFIXES = Object.freeze(["dk", "bl"]);
export const NEW_ID_PREFIX = "dk";
export const ID_RE = /^(dk|bl)-[0-9a-f]{8}$/;
export const FILE_RE = /^(dk|bl)-[0-9a-f]{8}\.md$/;
export const TOKEN_RE = /^[A-Za-z0-9._-]+$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const RANK_RE = /^[a-z]+$/;
