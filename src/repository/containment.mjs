// Contained-path check: a relative path supplied by a user or a registry stays inside its root,
// lexically (no absolute, drive, UNC or `..` escape, also after percent-decoding).
import path from "node:path";
import { CODES, docketError } from "../core/errors.mjs";

const escape = (what, detail) =>
  docketError(CODES.USAGE, `${what} escapes its checkout: ${detail}`, { path: detail });

/**
 * Normalise a relative, forward-slash path or throw DOCKET_USAGE. Rejects absolute and drive paths,
 * UNC and device prefixes, backslashes, NUL, empty or `.`/`..` segments, and percent-encoded forms of any
 * of these.
 */
export function relativeInside(rel, what = "path") {
  if (typeof rel !== "string" || !rel) throw escape(what, String(rel));
  let decoded = rel;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    throw escape(what, rel);
  }
  for (const s of new Set([rel, decoded])) {
    if (s.includes("\0") || s.includes("\\") || s.includes(":")) throw escape(what, rel);
    if (s.startsWith("/") || path.isAbsolute(s)) throw escape(what, rel);
    if (s.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
      throw escape(what, rel);
    }
  }
  return rel;
}
