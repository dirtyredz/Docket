// Contained-path checks. relativeInside: a relative path supplied by a user or a registry stays inside its
// root lexically (no absolute, drive, UNC or `..` escape, also after percent-decoding). The checkout
// guards: before a headless consumer hands a checkout to the item operations (which follow links), its
// item storage must be real paths inside the checkout, never links or junctions.
import fs from "node:fs";
import path from "node:path";
import { CODES, docketError } from "../core/errors.mjs";
import { canonicalPath, pathKey } from "./canonical.mjs";

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

/** True when the absolute `target` is `root` or below it (by path key; no fs access). */
export function lexicallyWithin(root, target) {
  const r = pathKey(root);
  const t = pathKey(target);
  return t === r || t.startsWith(`${r}/`);
}

/**
 * Throw DOCKET_USAGE unless the existing `target` resolves (through every link) to a location inside
 * `root`'s real path. Missing targets are allowed (nothing to escape through) unless `mustExist`.
 */
export function assertRealWithin(root, target, { what = "path", mustExist = false } = {}) {
  let real;
  try {
    real = canonicalPath(target);
  } catch (err) {
    if (err.code === "ENOENT" && !mustExist) return;
    throw err;
  }
  if (!lexicallyWithin(canonicalPath(root), real)) throw escape(what, target);
}

/** True when the path is a symbolic link or (on Windows) a junction. Missing paths are not links. */
export function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * The checkout guard every headless open runs: `docket.json`, `.docket/` and the items directory must
 * not be links and must resolve inside the checkout (so a linked `docs/` is caught too), and no entry in
 * the items directory may be a link or junction. Missing paths are fine (an empty store). Throws
 * DOCKET_USAGE ({path}) naming the offending path.
 */
export function assertSafeCheckout(ctx) {
  for (const p of [ctx.configPath, ctx.docketDir, ctx.itemsDir]) {
    if (isLink(p)) throw escape("link", p);
    assertRealWithin(ctx.root, p, { what: p });
  }
  let entries = [];
  try {
    // Directory entry types carry the link bit (junctions included on Windows): no lstat per item.
    entries = fs.readdirSync(ctx.itemsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw escape("link", `${ctx.itemsDir}/${entry.name}`);
  }
}
