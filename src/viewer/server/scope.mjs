// Registered-checkout authorization. Requests name repos and checkouts by registry id, never by path;
// item ids are checked against the schema before any filesystem lookup. A checkout is handed to core
// operations only after its registration is confirmed against Git (still the same clone, still a
// checkout root with docket.json) and its item storage is confirmed link-free and contained.
import fs from "node:fs";
import { CODES, docketError } from "../../core/errors.mjs";
import { ID_RE } from "../../core/format/schema.mjs";
import { assertSafeCheckout } from "../../repository/containment.mjs";
import { contextFor } from "../../repository/context.mjs";
import { CHECKOUT_ID_RE, REPO_ID_RE } from "../../state/registry/schema.mjs";
import { unavailableReason } from "../../state/registry/registration.mjs";
import { readRegistry } from "../../state/registry/store.mjs";

const VERIFY_TTL_MS = 5000;
const bad = (message) => docketError(CODES.USAGE, message);
const missing = (message) => docketError(CODES.NOT_FOUND, message);

/**
 * The registry, re-read when the file changes (registrations made while the server runs appear
 * without a restart). get() returns {registry, error}; a broken registry keeps serving the last good one.
 */
export function createRegistrySource(file) {
  let stamp = null;
  let current = { registry: { version: 1, repos: [] }, error: null };
  return {
    file,
    get() {
      let next;
      try {
        const st = fs.statSync(file);
        next = `${st.size}:${st.mtimeMs}`;
      } catch {
        next = "missing";
      }
      if (next !== stamp) {
        stamp = next;
        try {
          current = { registry: readRegistry(file), error: null };
        } catch (err) {
          current = { registry: current.registry, error: err.message };
        }
      }
      return current;
    },
  };
}

export function checkItemId(id) {
  if (!ID_RE.test(id ?? "")) throw bad("not an item id");
  return id;
}

/** {repo, checkout} for registry ids; checkoutId defaults to the repo's preferred checkout. */
export function lookup(registry, repoId, checkoutId) {
  if (!REPO_ID_RE.test(repoId ?? "")) throw bad("not a repo id");
  const repo = registry.repos.find((r) => r.id === repoId);
  if (!repo) throw missing("no such registered repo");
  const id = checkoutId ?? repo.preferred;
  if (!CHECKOUT_ID_RE.test(id)) throw bad("not a checkout id");
  const checkout = repo.checkouts.find((c) => c.id === id);
  if (!checkout) throw missing("no such registered checkout");
  return { repo, checkout };
}

/**
 * Open a registered checkout for core operations: {root, gitDir?, commonDir, itemsDir, docketDir,
 * configPath}. Reads may reuse a verification younger than VERIFY_TTL_MS; `fresh` (every mutation)
 * always re-verifies. Link and containment checks run every time. Throws DOCKET_NOT_FOUND when the
 * checkout is unavailable (never substituting another checkout).
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
        throw Object.assign(missing(`checkout unavailable: ${reason}`), { unavailable: reason });
      }
      verified.set(checkout.id, { at: now(), path: checkout.path });
    }
    const ctx = contextFor(checkout.path, repo.commonDir);
    assertSafeCheckout(ctx);
    return ctx;
  };
}

/**
 * Resolve route params {repo, checkout} to {repo, checkout, ctx}. `fresh` re-verifies the registration
 * against Git (every mutation does).
 */
export function openScoped({ registrySource, openCheckout }, params, { fresh = false } = {}) {
  const { registry } = registrySource.get();
  const { repo, checkout } = lookup(registry, params.repo, params.checkout);
  return { repo, checkout, ctx: openCheckout(repo, checkout, { fresh }) };
}

/**
 * Run a mutating operation on a registered checkout: validate the item id, open the checkout fresh
 * (re-verified against Git), call run(ctx, id), invalidate the catalog entry and return run's result.
 * Every mutating route goes through here; routes keep only request validation.
 */
export function mutateScoped(deps, params, run) {
  const id = checkItemId(params.id);
  const { repo, checkout, ctx } = openScoped(deps, params, { fresh: true });
  const out = run(ctx, id);
  deps.catalog.invalidate(repo, checkout);
  return out;
}
