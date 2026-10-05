// The seven living documents of a checkout. Each resolves through its explicit registry override,
// then `<NAME>.md` at the root, then `docs/<NAME>.md`; no other layout is guessed. Every candidate is
// contained in the checkout (lexically and through links); duplicates are reported with the chosen
// source. Reading is the only operation: there is no document write path.
import fs from "node:fs";
import { CODES, docketError } from "../../core/errors.mjs";
import { assertRealWithin, isLink, relativeInside } from "../../repository/containment.mjs";
import { DOC_NAMES } from "../../state/registry/schema.mjs";

export const MAX_DOC_BYTES = 2 * 1024 * 1024;

function exists(root, rel) {
  const p = `${root}/${rel}`;
  try {
    if (isLink(p)) return false;
    assertRealWithin(root, p);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve every document for checkout `root` with `overrides` ({NAME: relative path}). Returns
 * [{name, source (relative path) | null, via: override | root | docs | null, duplicates: [rel],
 * overrideMissing?: rel}].
 */
export function resolveDocuments(root, overrides = {}) {
  return DOC_NAMES.map((name) => {
    const candidates = [];
    const override = overrides[name];
    if (override) candidates.push({ rel: relativeInside(override, name), via: "override" });
    candidates.push({ rel: `${name}.md`, via: "root" }, { rel: `docs/${name}.md`, via: "docs" });
    const found = candidates.filter((c) => exists(root, c.rel));
    const chosen = found[0] ?? null;
    return {
      name,
      source: chosen?.rel ?? null,
      via: chosen?.via ?? null,
      duplicates: found.slice(1).map((c) => c.rel),
      ...(override && !exists(root, override) ? { overrideMissing: override } : {}),
    };
  });
}

/** Read one resolved document's text. Throws DOCKET_NOT_FOUND when it has no source. */
export function readDocument(root, entry) {
  if (!entry?.source) throw docketError(CODES.NOT_FOUND, `no ${entry?.name ?? "such"} document`);
  const p = `${root}/${entry.source}`;
  if (isLink(p)) throw docketError(CODES.NOT_FOUND, `${entry.name} is a link`);
  assertRealWithin(root, p, { mustExist: true });
  const st = fs.statSync(p);
  if (st.size > MAX_DOC_BYTES) throw docketError(CODES.INVALID, `${entry.name} is too large`);
  return fs.readFileSync(p, "utf8");
}
