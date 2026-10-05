// Registration: checkouts grouped by canonical Git common directory (linked worktrees join one logical
// repo; independent clones stay separate), unique case-insensitive aliases, the preferred checkout and
// document overrides. Pure functions over a registry document; persistence is store.mjs.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CODES, docketError } from "../../core/errors.mjs";
import { canonicalPath, pathKey, sameKey } from "../../repository/canonical.mjs";
import { parseConfig, readConfigBytes } from "../../repository/config.mjs";
import { resolveRepo } from "../../repository/context.mjs";
import { ALIAS_RE, checkDocPath, DOC_NAMES } from "./schema.mjs";

const usage = (message, details) => docketError(CODES.USAGE, message, details);

/**
 * Facts about the checkout at `p`: {root, commonDir, main}. Paths are canonical. Requires `p` to be in
 * a Git checkout whose root carries a supported docket.json. Throws DOCKET_NOT_A_REPO / DOCKET_USAGE.
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
    const name = spec.slice(0, eq).toUpperCase();
    const rel = spec.slice(eq + 1);
    if (!DOC_NAMES.includes(name)) {
      throw usage(`unknown document ${name} (one of ${DOC_NAMES.join(", ")})`);
    }
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

/** Registry view for `repo list`: every checkout with availability and the reason when unavailable. */
export function describeRegistry(registry) {
  return registry.repos.map((repo) => ({
    id: repo.id,
    alias: repo.alias,
    commonDir: repo.commonDir,
    docs: repo.docs,
    checkouts: repo.checkouts.map((c) => {
      const reason = unavailableReason(repo, c);
      return {
        id: c.id,
        path: c.path,
        preferred: c.id === repo.preferred,
        available: reason === null,
        ...(reason ? { reason } : {}),
      };
    }),
  }));
}
