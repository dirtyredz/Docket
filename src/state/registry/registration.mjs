// Registration: checkouts grouped by canonical Git common directory (linked worktrees join one logical
// repo; independent clones stay separate), unique case-insensitive aliases, the preferred checkout and
// document overrides. Pure functions over a registry document: persistence is store.mjs, long-lived
// reads and id lookup are source.mjs, checkout identity and availability are
// repository/registered-checkout.mjs, and the `repo list` view is the CLI adapter's.
import { randomBytes } from "node:crypto";
import path from "node:path";
import { CODES, docketError } from "../../core/errors.mjs";
import { canonicalPath, pathKey, sameKey } from "../../repository/canonical.mjs";
import { ALIAS_RE, assertDocName, checkDocPath } from "./schema.mjs";

const usage = (message, details) => docketError(CODES.USAGE, message, details);

/** A fresh "<prefix>-<8hex>" id not in `taken` (a Set, updated with the new id). */
function freshId(prefix, taken) {
  for (;;) {
    const id = `${prefix}-${randomBytes(4).toString("hex")}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

const takenIds = (registry) =>
  new Set(registry.repos.flatMap((r) => [r.id, ...r.checkouts.map((c) => c.id)]));
const newId = (prefix, registry) => freshId(prefix, takenIds(registry));

/** A legal alias derived from a directory name. */
export function aliasFrom(name) {
  const cleaned = String(name)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 64);
  return cleaned || "repo";
}

export const aliasTaken = (registry, alias, exceptId = null) =>
  registry.repos.some((r) => r.id !== exceptId && r.alias.toLowerCase() === alias.toLowerCase());

function checkAlias(registry, alias, exceptId) {
  if (!ALIAS_RE.test(alias)) {
    throw usage(`alias "${alias}" must be letters, digits, ".", "_" or "-" (max 64)`);
  }
  if (aliasTaken(registry, alias, exceptId)) {
    throw docketError(CODES.EXISTS, `alias "${alias}" is already registered`, { alias });
  }
}

/** Parse repeatable `NAME=relative/path.md` overrides; an empty path removes the override. */
export function parseDocOverrides(list) {
  const docs = {};
  for (const spec of list) {
    const eq = spec.indexOf("=");
    if (eq < 1) throw usage(`--doc must be NAME=relative/path.md, got "${spec}"`);
    const name = assertDocName(spec.slice(0, eq).toUpperCase());
    const rel = spec.slice(eq + 1);
    docs[name] = rel === "" ? "" : checkDocPath(name, rel);
  }
  return docs;
}

export const findRepoByCommonDir = (registry, commonDir) =>
  registry.repos.find((r) => sameKey(r.commonDir, commonDir));

export function findRepoByAlias(registry, alias) {
  const repo = registry.repos.find((r) => r.alias.toLowerCase() === String(alias).toLowerCase());
  if (!repo) throw docketError(CODES.NOT_FOUND, `no registered repo "${alias}"`, { alias });
  return repo;
}

function applyDocs(repo, docs = {}) {
  for (const [name, rel] of Object.entries(docs)) {
    if (rel === "") delete repo.docs[name];
    else repo.docs[name] = rel;
  }
}

/**
 * Add a new group for `info` under `alias` (already checked). `checkoutPaths` defaults to the one
 * checkout; the preferred checkout is info.root when listed, else the first path.
 */
export function createGroup(registry, info, alias, checkoutPaths = [info.root]) {
  const taken = takenIds(registry);
  const checkouts = checkoutPaths.map((p) => ({ id: freshId("c", taken), path: p }));
  const preferred = checkouts.find((c) => sameKey(c.path, info.root)) ?? checkouts[0];
  const repo = {
    id: freshId("r", taken),
    alias,
    commonDir: info.commonDir,
    preferred: preferred.id,
    checkouts,
    docs: {},
  };
  registry.repos.push(repo);
  return { repo, checkout: preferred };
}

/** Add the checkout at canonical `root` to an existing group. Returns the new checkout. */
export function joinGroup(registry, repo, root) {
  const checkout = { id: newId("c", registry), path: root };
  repo.checkouts.push(checkout);
  return checkout;
}

/**
 * Register checkout `info` (from inspectCheckout). options: {alias?, prefer?, docs?}.
 * Idempotent by canonical checkout path. A new group gets `alias` (default: the checkout's directory
 * name; a collision fails) and this checkout as preferred. Re-adding updates alias, preferred (with
 * `prefer`) and document overrides. Returns {repo, checkout, change: created | joined | updated |
 * unchanged}.
 */
export function registerCheckout(registry, info, { alias, prefer = false, docs } = {}) {
  let repo = findRepoByCommonDir(registry, info.commonDir);
  if (!repo) {
    const name = alias ?? aliasFrom(path.basename(info.root));
    checkAlias(registry, name, null);
    const created = createGroup(registry, info, name);
    applyDocs(created.repo, docs);
    return { ...created, change: "created" };
  }
  const before = JSON.stringify(repo);
  let checkout = repo.checkouts.find((c) => sameKey(c.path, info.root));
  let change = "updated";
  if (!checkout) {
    checkout = joinGroup(registry, repo, info.root);
    change = "joined";
  }
  if (alias !== undefined && alias !== repo.alias) {
    checkAlias(registry, alias, repo.id);
    repo.alias = alias;
  }
  if (prefer) repo.preferred = checkout.id;
  applyDocs(repo, docs);
  if (change === "updated" && JSON.stringify(repo) === before) change = "unchanged";
  return { repo, checkout, change };
}

/**
 * Remove a repo's registration (metadata only; nothing on disk is touched), or with `checkout` (a path)
 * just that checkout. Removing the preferred checkout prefers the first remaining one and says so;
 * removing the last checkout removes the repo. Returns {removed: "repo" | "checkout", repo, checkout?,
 * preferred?}.
 */
export function unregister(registry, alias, { checkout: checkoutPath } = {}) {
  const repo = findRepoByAlias(registry, alias);
  if (checkoutPath === undefined) {
    registry.repos = registry.repos.filter((r) => r !== repo);
    return { removed: "repo", repo };
  }
  let key;
  try {
    key = pathKey(canonicalPath(checkoutPath));
  } catch {
    key = pathKey(checkoutPath); // a vanished checkout is removed by its recorded path
  }
  const checkout = repo.checkouts.find((c) => pathKey(c.path) === key);
  if (!checkout) {
    throw docketError(CODES.NOT_FOUND, `${repo.alias} has no checkout ${checkoutPath}`, {
      alias,
      checkout: checkoutPath,
    });
  }
  repo.checkouts = repo.checkouts.filter((c) => c !== checkout);
  if (!repo.checkouts.length) {
    registry.repos = registry.repos.filter((r) => r !== repo);
    return { removed: "repo", repo, checkout };
  }
  let preferred = null;
  if (repo.preferred === checkout.id) {
    repo.preferred = repo.checkouts[0].id;
    preferred = repo.checkouts[0];
  }
  return { removed: "checkout", repo, checkout, preferred };
}
