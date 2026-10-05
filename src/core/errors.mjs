// The one error shape. Every failure Docket raises on purpose is a docketError: an Error with a stable
// `code` (DOCKET_*), optional structured `details`, and a `kind` in the table below that tells the CLI
// which exit code it maps to (kinds are the keys of cli/output.mjs EXIT). Unknown or non-DOCKET codes
// are internal errors.

/** code name -> [code string, exit kind]. Kinds: usage, conflict, notFound, failed, internal. */
const TABLE = {
  USAGE: ["DOCKET_USAGE", "usage"],
  NOT_A_REPO: ["DOCKET_NOT_A_REPO", "usage"],
  BAD_REF: ["DOCKET_BAD_REF", "usage"],
  CONFLICT: ["DOCKET_CONFLICT", "conflict"],
  LOCKED: ["DOCKET_LOCKED", "conflict"],
  CLAIMED: ["DOCKET_CLAIMED", "conflict"],
  EXISTS: ["DOCKET_EXISTS", "conflict"],
  NOT_FOUND: ["DOCKET_NOT_FOUND", "notFound"],
  INVALID: ["DOCKET_INVALID", "failed"],
  INTERNAL: ["DOCKET_INTERNAL", "internal"],
  GIT: ["DOCKET_GIT", "failed"],
  ID_EXHAUSTED: ["DOCKET_ID_EXHAUSTED", "failed"],
  RANK_GAP: ["DOCKET_RANK_GAP", "failed"],
  SMOKE: ["DOCKET_SMOKE", "failed"],
  BAD_TARBALL: ["DOCKET_BAD_TARBALL", "failed"],
  GATE_NOT_PROMOTED: ["DOCKET_GATE_NOT_PROMOTED", "failed"],
  TEMPLATE_MISSING: ["DOCKET_TEMPLATE_MISSING", "failed"],
  TEMPLATE_TOO_OLD: ["DOCKET_TEMPLATE_TOO_OLD", "failed"],
};

/** Code constants by name: `CODES.NOT_FOUND === "DOCKET_NOT_FOUND"`. */
export const CODES = Object.freeze(
  Object.fromEntries(Object.entries(TABLE).map(([name, [code]]) => [name, code])),
);

/** Exit kind per code string (`usage`, `conflict`, `notFound`, `failed`, `internal`). */
export const KIND_OF_CODE = Object.freeze(
  Object.fromEntries(Object.values(TABLE).map(([code, kind]) => [code, kind])),
);

/** Build an Error carrying `code` (a CODES value), and `details` when given. */
export function docketError(code, message, details) {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

export const notFound = (id) => docketError(CODES.NOT_FOUND, `no item ${id}`, { id });
