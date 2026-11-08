// The registry as a long-lived reader sees it (the viewer, library consumers): re-read when the file
// changes, so registrations made while the reader runs appear without a restart, and a broken file keeps
// serving the last good document. Plus id-addressed lookup: readers name repos and checkouts by registry
// id, never by path, and an unknown checkout is an error, never a fallback to another checkout.
import fs from "node:fs";
import { CODES, docketError } from "../../core/errors.mjs";
import { CHECKOUT_ID_RE, REPO_ID_RE, emptyRegistry } from "./schema.mjs";
import { readRegistry } from "./store.mjs";

const bad = (message) => docketError(CODES.USAGE, message);
const missing = (message) => docketError(CODES.NOT_FOUND, message);

/** The (size, mtime) stamp of `file`, or "missing". */
function stampOf(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return "missing";
  }
}

/**
 * A last-good registry source over `file`. get() returns {registry, error, missing}: `registry` is the
 * current document (or the last good one), `error` the message of the read that failed (null when the
 * current file is good), `missing` true when there is no registry file (an empty registry). Re-reads
 * only when the file's size or mtime changed.
 */
export function createRegistrySource(file) {
  let stamp = null;
  let current = { registry: emptyRegistry(), error: null, missing: false };
  return {
    file,
    get() {
      const next = stampOf(file);
      if (next !== stamp) {
        stamp = next;
        try {
          current = { registry: readRegistry(file), error: null, missing: next === "missing" };
        } catch (err) {
          current = { registry: current.registry, error: err.message, missing: false };
        }
      }
      return current;
    },
  };
}

/**
 * {repo, checkout} for registry ids. checkoutId defaults to the repo's preferred checkout. Malformed
 * ids throw DOCKET_USAGE; an unknown repo or checkout throws DOCKET_NOT_FOUND.
 */
export function findCheckout(registry, repoId, checkoutId) {
  if (!REPO_ID_RE.test(repoId ?? "")) throw bad("not a repo id");
  const repo = registry.repos.find((r) => r.id === repoId);
  if (!repo) throw missing("no such registered repo");
  const id = checkoutId ?? repo.preferred;
  if (!CHECKOUT_ID_RE.test(id)) throw bad("not a checkout id");
  const checkout = repo.checkouts.find((c) => c.id === id);
  if (!checkout) throw missing("no such registered checkout");
  return { repo, checkout };
}
