// Real-path identity. Two spellings of one existing directory (case, 8.3 short names, junctions,
// symlinks, `..`) canonicalize to the same forward-slash path; `pathKey` is the comparison key
// (case-insensitive on Windows).
import fs from "node:fs";
import path from "node:path";
import { toSlash } from "./paths.mjs";

/** Canonical forward-slash real path of an existing path. Throws the fs error (ENOENT, EACCES...). */
export function canonicalPath(p) {
  return toSlash(fs.realpathSync.native(path.resolve(p)));
}

/** Canonical path, or null when the path does not exist or cannot be resolved. */
export function tryCanonicalPath(p) {
  try {
    return canonicalPath(p);
  } catch {
    return null;
  }
}

/** Comparison key for an absolute path: forward slashes, no trailing slash, lower-cased on Windows. */
export function pathKey(p) {
  const s = toSlash(path.resolve(p)).replace(/\/+$/, "");
  return process.platform === "win32" ? s.toLowerCase() : s;
}

/** True when two absolute paths name the same location (by key; resolve real paths first). */
export const sameKey = (a, b) => pathKey(a) === pathKey(b);
