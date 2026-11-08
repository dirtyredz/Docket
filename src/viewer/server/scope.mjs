// The viewer's registered-checkout scope: route params name repos and checkouts by registry id, never by
// path, and item ids are checked against the schema before any filesystem lookup. The policies live in
// their own domains and are shared with library consumers: the last-good registry source and id lookup
// (state/registry/source.mjs), registration verification and containment
// (repository/registered-checkout.mjs). This module only binds them to route params and the catalog.
import { CODES, docketError } from "../../core/errors.mjs";
import { ID_RE } from "../../core/format/schema.mjs";
import { findCheckout } from "../../state/registry/source.mjs";

export function checkItemId(id) {
  if (!ID_RE.test(id ?? "")) throw docketError(CODES.USAGE, "not an item id");
  return id;
}

/**
 * Resolve route params {repo, checkout} to {repo, checkout, ctx}. `fresh` re-verifies the registration
 * against Git (every mutation does).
 */
export function openScoped({ registrySource, openCheckout }, params, { fresh = false } = {}) {
  const { registry } = registrySource.get();
  const { repo, checkout } = findCheckout(registry, params.repo, params.checkout);
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
