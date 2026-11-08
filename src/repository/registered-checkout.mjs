// Registered-checkout verification: is the checkout a registration names still that checkout? A path is
// usable only while it is a Git checkout ROOT carrying a supported docket.json and still belongs to the
// registered clone (same canonical Git common dir). The opener adds the link/containment checks every
// core operation needs and never substitutes another checkout. Registrations are plain data here
// ({commonDir} and {id, path}); reading and writing the registry is state/registry's job.
import fs from "node:fs";
import { CODES, docketError } from "../core/errors.mjs";
import { canonicalPath, sameKey } from "./canonical.mjs";
import { parseConfig, readConfigBytes } from "./config.mjs";
import { assertSafeCheckout } from "./containment.mjs";
import { contextFor, resolveRepo } from "./context.mjs";

const VERIFY_TTL_MS = 5000;
const usage = (message, details) => docketError(CODES.USAGE, message, details);

/**
 * Facts about the checkout at `p`: {root, commonDir, main}. Paths are canonical. Requires `p` to be in
 * a Git checkout whose root carries a supported docket.json. `root` may be an ancestor of `p`: callers
 * that need `p` itself to be the root compare them. Throws DOCKET_NOT_A_REPO / DOCKET_USAGE.
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
  const bytes = readConfigBytes({ configPath: `${root}/docket.json` });
  if (bytes === null) {
    throw usage(`${root} has no docket.json (run docket init there first)`, { root });
  }
  const { error } = parseConfig(bytes);
  if (error) throw usage(`${root}/docket.json: ${error.message}`, { root });
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
 * openCheckout(repo, checkout, {fresh}) for registered checkouts: returns the context core operations
 * take ({root, commonDir, itemsDir, docketDir, configPath}). Reads may reuse a verification younger
 * than VERIFY_TTL_MS; `fresh` (every mutation) always re-verifies against Git. Link and containment
 * checks run every time. Throws DOCKET_NOT_FOUND with `unavailable` (the reason) when the checkout is
 * unavailable, and DOCKET_USAGE when its item storage is a link or escapes the checkout.
 */
export function createCheckoutOpener({ now = Date.now } = {}) {
  const verified = new Map();
  return function openCheckout(repo, checkout, { fresh = false } = {}) {
    const hit = verified.get(checkout.id);
    // A vanished checkout is caught even inside the cache window (loadIndex would otherwise recreate
    // its directory to save the cache).
    if (!fs.existsSync(`${checkout.path}/docket.json`)) verified.delete(checkout.id);
    if (
      fresh ||
      !verified.has(checkout.id) ||
      now() - hit.at > VERIFY_TTL_MS ||
      hit.path !== checkout.path
    ) {
      const reason = unavailableReason(repo, checkout);
      if (reason) {
        verified.delete(checkout.id);
        throw Object.assign(docketError(CODES.NOT_FOUND, `checkout unavailable: ${reason}`), {
          unavailable: reason,
        });
      }
      verified.set(checkout.id, { at: now(), path: checkout.path });
    }
    const ctx = contextFor(checkout.path, repo.commonDir);
    assertSafeCheckout(ctx);
    return ctx;
  };
}
