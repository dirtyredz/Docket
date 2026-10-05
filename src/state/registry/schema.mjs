// Registry document, version 1. Machine metadata only: no items, counts, claims or search index.
//   {version: 1, repos: [{id, alias, commonDir, preferred, checkouts: [{id, path}], docs: {NAME: rel}}]}
// id: "r-<8hex>", checkout id: "c-<8hex>" (generated, stable; the viewer addresses repos by these, never
// by paths). commonDir: canonical Git common directory (the group identity). preferred: a checkout id.
// docs: relative overrides for the seven living documents.
import { CODES, docketError } from "../../core/errors.mjs";
import { relativeInside } from "../../repository/containment.mjs";

export const REGISTRY_VERSION = 1;
export const DOC_NAMES = Object.freeze([
  "STRUCTURE",
  "ARCHITECTURE",
  "DECISIONS",
  "FEATURES",
  "ROADMAP",
  "BACKLOG",
  "GOTCHAS",
]);
export const ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const REPO_ID_RE = /^r-[0-9a-f]{8}$/;
export const CHECKOUT_ID_RE = /^c-[0-9a-f]{8}$/;

export const emptyRegistry = () => ({ version: REGISTRY_VERSION, repos: [] });

const invalid = (message) => docketError(CODES.INVALID, `registry: ${message}`);

/** Validate a document override path (relative, contained, Markdown). Returns it or throws USAGE. */
export function checkDocPath(name, rel) {
  if (!DOC_NAMES.includes(name)) {
    throw docketError(CODES.USAGE, `unknown document ${name} (one of ${DOC_NAMES.join(", ")})`);
  }
  relativeInside(rel, `document ${name}`);
  if (!/\.md$/i.test(rel)) throw docketError(CODES.USAGE, `document ${name} must be a .md file`);
  return rel;
}

/** Throw DOCKET_INVALID unless `doc` is a well-formed version-1 registry. */
export function validateRegistry(doc) {
  if (!doc || typeof doc !== "object") throw invalid("not an object");
  if (doc.version !== REGISTRY_VERSION) {
    throw invalid(`unsupported version ${JSON.stringify(doc.version)} (this docket reads 1)`);
  }
  if (!Array.isArray(doc.repos)) throw invalid("repos must be an array");
  const ids = new Set();
  const aliases = new Set();
  for (const r of doc.repos) {
    if (!REPO_ID_RE.test(r?.id ?? "")) throw invalid(`bad repo id ${JSON.stringify(r?.id)}`);
    if (!ALIAS_RE.test(r.alias ?? "")) throw invalid(`bad alias ${JSON.stringify(r.alias)}`);
    if (typeof r.commonDir !== "string" || !r.commonDir) throw invalid(`${r.alias}: no commonDir`);
    if (!Array.isArray(r.checkouts) || !r.checkouts.length) {
      throw invalid(`${r.alias}: no checkouts`);
    }
    for (const c of r.checkouts) {
      if (!CHECKOUT_ID_RE.test(c?.id ?? "") || typeof c.path !== "string") {
        throw invalid(`${r.alias}: bad checkout ${JSON.stringify(c)}`);
      }
      if (ids.has(c.id)) throw invalid(`duplicate id ${c.id}`);
      ids.add(c.id);
    }
    if (!r.checkouts.some((c) => c.id === r.preferred)) {
      throw invalid(`${r.alias}: preferred is not one of its checkouts`);
    }
    if (!r.docs || typeof r.docs !== "object") throw invalid(`${r.alias}: docs must be an object`);
    for (const [name, rel] of Object.entries(r.docs)) {
      try {
        checkDocPath(name, rel);
      } catch (err) {
        throw invalid(`${r.alias}: ${err.message}`);
      }
    }
    if (ids.has(r.id)) throw invalid(`duplicate id ${r.id}`);
    ids.add(r.id);
    const key = r.alias.toLowerCase();
    if (aliases.has(key)) throw invalid(`duplicate alias ${r.alias}`);
    aliases.add(key);
  }
  return doc;
}
