// Path identity. Docket stores and compares absolute paths with forward slashes; on Windows two
// spellings that differ only in case name the same directory.
import path from "node:path";

/** Where item files live, relative to the worktree root (always forward slashes). */
export const ITEMS_DIR = "docs/items";

/** The same path with forward slashes (no resolution). */
export const toSlash = (p) => p.split(path.sep).join("/");

/** True when `a` and `b` resolve to the same path (case-insensitive on Windows). */
export function samePath(a, b) {
  const norm = (p) => toSlash(path.resolve(p));
  return process.platform === "win32"
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b);
}
