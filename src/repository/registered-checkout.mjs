// Checkout identity and verified opening. inspectCheckout reports the facts that identify a checkout (its
// canonical root and Git common dir); unavailableReason says why a registered checkout cannot be used; the
// openers return the context core operations take, only after verifying identity and running the
// containment guard, and never substitute another checkout. Registrations are plain data here
// ({id, commonDir} and {id, path}); reading and writing the registry is state/registry's job.
import fs from "node:fs";
import { CODES, docketError } from "../core/errors.mjs";
import { canonicalPath, sameKey } from "./canonical.mjs";
import { parseConfig, readConfigBytes } from "./config.mjs";
import { assertSafeCheckout } from "./containment.mjs";
import { contextAtRoot, contextFor, resolveRepo } from "./context.mjs";

/** How long a read may reuse a registered checkout's verification. */
export const VERIFY_TTL_MS = 5000;

const usage = (message, details) => docketError(CODES.USAGE, message, details);

/** Throw DOCKET_USAGE unless canonical `root` carries a docket.json this build supports. */
function assertSupportedConfig(root) {
  const bytes = readConfigBytes({ configPath: `${root}/docket.json` });
  if (bytes === null) {
    throw usage(`${root} has no docket.json (run docket init there first)`, { root });
  }
  const { error } = parseConfig(bytes);
  if (error) throw usage(`${root}/docket.json: ${error.message}`, { root });
}

/**
 * Facts about the checkout at `p`: {root, commonDir, main}. Paths are canonical. Requires `p` to be in
 * a Git checkout whose root carries a supported docket.json. `root` may be an ancestor of `p` (the
 * registry's `repo add` and `scan` accept that and compare); a consumer that needs `p` itself to be the
 * root uses openCheckoutAt. Throws DOCKET_NOT_A_REPO / DOCKET_USAGE.
 */
export function inspectCheckout(p) {
  let real;
  try {
    real = canonicalPath(p);
  } catch {
    throw docketError(CODES.NOT_A_REPO, `no such directory: ${p}`);
  }
  const ctx = resolveRepo(real);
  const root = canonicalPath(ctx.root);
  const commonDir = canonicalPath(ctx.commonDir);
  assertSupportedConfig(root);
  return { root, commonDir, main: sameKey(canonicalPath(ctx.gitDir), commonDir) };
}

/** Why a registered checkout cannot be used right now, or null when it is available. */
export function unavailableReason(repo, checkout) {
  if (!fs.existsSync(checkout.path)) return "path does not exist";
  let info;
  try {
    info = inspectCheckout(checkout.path);
  } catch (err) {
    return err.message;
  }
  if (!sameKey(info.root, checkout.path)) return `not a checkout root (root is ${info.root})`;
  if (!sameKey(info.commonDir, repo.commonDir)) return "now belongs to a different clone";
  return null;
}

/**
 * Open the checkout whose root is exactly `root` (an unregistered path, such as a Command Deck project
 * folder): no ancestor discovery, a supported docket.json, and the containment guard. Never initializes
 * or registers anything. Returns the context ({root, gitDir, commonDir, itemsDir, docketDir,
 * configPath}, canonical). Throws DOCKET_NOT_A_REPO (not exactly a checkout root) or DOCKET_USAGE (no or
 * unsupported docket.json, linked or escaping item storage).
 */
export function openCheckoutAt(root) {
  const ctx = contextAtRoot(root);
  assertSupportedConfig(ctx.root);
  assertSafeCheckout(ctx);
  return ctx;
}

/**
 * A long-lived opener for registered checkouts: openCheckout(repo, checkout, {fresh}) returns the context
 * core operations take ({root, commonDir, itemsDir, docketDir, configPath}). A read may reuse a
 * verification younger than `ttlMs` made for the same repo id, checkout id, path and common dir; `fresh`
 * (pass it before every mutation) always re-verifies against Git. The containment guard runs on every
 * open. An unavailable checkout throws DOCKET_NOT_FOUND with details {repo, checkout, unavailable} (the
 * reason) and is never replaced by another checkout; linked or escaping item storage throws DOCKET_USAGE.
 */
export function createCheckoutOpener({ now = Date.now, ttlMs = VERIFY_TTL_MS } = {}) {
  const verified = new Map();
  return function openCheckout(repo, checkout, { fresh = false } = {}) {
    const key = `${repo.id}\u0000${checkout.id}`;
    const hit = verified.get(key);
    const reusable =
      !fresh &&
      hit !== undefined &&
      now() - hit.at <= ttlMs &&
      hit.path === checkout.path &&
      hit.commonDir === repo.commonDir &&
      // A vanished checkout is caught even inside the window (loadIndex would otherwise recreate its
      // .docket directory to save the cache).
      fs.existsSync(`${checkout.path}/docket.json`);
    if (!reusable) {
      verified.delete(key);
      const reason = unavailableReason(repo, checkout);
      if (reason) {
        throw docketError(CODES.NOT_FOUND, `checkout unavailable: ${reason}`, {
          repo: repo.id,
          checkout: checkout.id,
          unavailable: reason,
        });
      }
      verified.set(key, { at: now(), path: checkout.path, commonDir: repo.commonDir });
    }
    const ctx = contextFor(checkout.path, repo.commonDir);
    assertSafeCheckout(ctx);
    return ctx;
  };
}
