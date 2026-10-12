// The registry as a long-lived reader sees it (Command Deck's Docket worker, other library consumers):
// re-read when the file changes, or on an explicit refresh, so registrations made while the reader runs
// appear without a restart, and a broken file keeps serving the last good document with a visible error.
// Plus strict id-addressed lookup: readers name repos and checkouts by registry id, never by path, and an
// unknown or foreign checkout is an error, never a fallback to another checkout.
import fs from "node:fs";
import { CODES, docketError } from "../../core/errors.mjs";
import { CHECKOUT_ID_RE, REPO_ID_RE, emptyRegistry } from "./schema.mjs";
import { readRegistry } from "./store.mjs";

const bad = (message, details) => docketError(CODES.USAGE, message, details);
const missing = (message, details) => docketError(CODES.NOT_FOUND, message, details);

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
 * A last-good registry source over `file` (registryPath(env)). get({refresh}) returns
 * {registry, error, missing}: `registry` is the current document, or the last good one while the file is
 * broken; `error` is {code, message} of the read that failed (null when the current file is good);
 * `missing` is true when there is no registry file (an empty registry). get() re-reads only when the
 * file's size or mtime changed; get({refresh: true}) always re-reads (a manual Refresh, or a same-size
 * rewrite inside one mtime tick). A registry that is broken from the start serves an empty registry.
 */
export function createRegistrySource(file) {
  let stamp = null;
  let current = { registry: emptyRegistry(), error: null, missing: false };
  return {
    file,
    get({ refresh = false } = {}) {
      const next = stampOf(file);
      if (refresh || next !== stamp) {
        stamp = next;
        try {
          current = { registry: readRegistry(file), error: null, missing: next === "missing" };
        } catch (err) {
          const error = { code: err.code ?? CODES.INTERNAL, message: err.message };
          current = { registry: current.registry, error, missing: false };
        }
      }
      return current;
    },
  };
}

/**
 * {repo, checkout} for registry ids. checkoutId defaults to the repo's preferred checkout; the checkout
 * must belong to that repo. Malformed ids throw DOCKET_USAGE; an unknown repo, or a checkout that is not
 * one of this repo's, throws DOCKET_NOT_FOUND. Availability is the opener's job: an unavailable preferred
 * checkout is still the one returned, so it fails there instead of silently switching checkouts.
 */
export function findCheckout(registry, repoId, checkoutId) {
  if (typeof repoId !== "string" || !REPO_ID_RE.test(repoId)) {
    throw bad("not a repo id", { repo: repoId ?? null });
  }
  const repo = registry.repos.find((r) => r.id === repoId);
  if (!repo) throw missing("no such registered repo", { repo: repoId });
  const id = checkoutId ?? repo.preferred;
  if (typeof id !== "string" || !CHECKOUT_ID_RE.test(id)) {
    throw bad("not a checkout id", { checkout: id ?? null });
  }
  const checkout = repo.checkouts.find((c) => c.id === id);
  if (!checkout) throw missing("no such registered checkout", { repo: repoId, checkout: id });
  return { repo, checkout };
}
