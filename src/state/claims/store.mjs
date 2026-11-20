// Persistence for <git-common-dir>/docket-claims.json (envelope v2: `claims` + `work`), guarded by
// its own lock (never the item lock), replaced atomically. Advisory claims whose worktree path no
// longer exists expire on read and are dropped on the next write; retained `work` bindings
// (item -> worktree/branch) outlive claims, and v1 files read their claims as legacy work. Pure
// persistence: locked envelope reads and writes, with no item imports or item-mutation callbacks
// (work.mjs composes them with item operations); imports only the core/errors.mjs leaf. Never
// committed.
import fs from "node:fs";
import path from "node:path";
import { CODES, docketError } from "../../core/errors.mjs";
import { samePath, toSlash } from "../../repository/paths.mjs";
import { atomicWrite } from "../../storage/atomic-write.mjs";
import { withLock } from "../../storage/lock.mjs";

const FILE = "docket-claims.json";

export const claimsPath = (commonDir) => path.join(commonDir, FILE);
const lockPath = (commonDir) => path.join(commonDir, `${FILE}.lock`);

function readRaw(commonDir) {
  try {
    const data = JSON.parse(fs.readFileSync(claimsPath(commonDir), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch (err) {
    if (err.code === "ENOENT") return {};
    // A corrupt claims file loses only advisory data; start over rather than block work.
    return {};
  }
}

/** Live claims (expired ones filtered out) plus the IDs that expired. */
export function readClaims(commonDir, { exists = fs.existsSync } = {}) {
  const claims = {};
  const expired = [];
  for (const [id, c] of Object.entries(readRaw(commonDir).claims ?? {})) {
    if (c && typeof c.worktree === "string" && exists(c.worktree)) claims[id] = c;
    else expired.push(id);
  }
  return { claims, expired };
}

/** Replace the envelope; callers hold the claims lock (withWorkLock). */
export function write(commonDir, claims, work = readWork(commonDir)) {
  const sorted = Object.fromEntries(Object.entries(claims).sort(([a], [b]) => (a < b ? -1 : 1)));
  atomicWrite(
    claimsPath(commonDir),
    JSON.stringify({ version: 2, claims: sorted, work }, null, 2) + "\n",
  );
}

const claimedError = (id, holder) =>
  docketError(
    CODES.CLAIMED,
    `${id} is claimed by ${holder.worktree} (${holder.branch ?? "detached"})`,
    { id, holder },
  );

/**
 * Add a claim for `id` to the live `claims` map (callers hold the lock). Re-claiming from the same
 * worktree refreshes it; a live claim held by another worktree is rejected unless `takeover`.
 */
export function buildClaim(
  claims,
  id,
  { worktree, branch = null, agent = null, takeover = false, now = new Date() },
) {
  const previous = claims[id] ?? null;
  if (previous && !samePath(previous.worktree, worktree) && !takeover) {
    throw claimedError(id, previous);
  }
  const claim = {
    worktree: toSlash(path.resolve(worktree)),
    branch,
    agent,
    at: now.toISOString(),
  };
  claims[id] = claim;
  return { claim, previous };
}

/** Claim `id` for `worktree` under the lock. Returns {claim, previous}. */
export function claimItem(commonDir, id, options) {
  return withLock(lockPath(commonDir), () => {
    const { claims } = readClaims(commonDir);
    const result = buildClaim(claims, id, options);
    write(commonDir, claims);
    return result;
  });
}

/** Retained evidence is independent of advisory claim lifetime. Legacy claims remain usable. */
export function readWork(commonDir) {
  const raw = readRaw(commonDir);
  const work = raw.work ?? (raw.version === 1 ? raw.claims : {}) ?? {};
  return work && typeof work === "object" && !Array.isArray(work) ? work : {};
}

/** Record `binding` as the retained work evidence for each of `ids`. */
export function recordBinding(work, ids, binding) {
  for (const id of ids) work[id] = binding;
}

/** Common-dir before item lock: serialize binding changes with release and takeover. */
export function withWorkLock(commonDir, run) {
  return withLock(lockPath(commonDir), () => run(readWork(commonDir)));
}

/**
 * Release `id`. Only the holding worktree may release unless `force`. Returns {released, claim}.
 * Releasing an unclaimed item is a no-op (released: false).
 */
export function releaseItem(commonDir, id, { worktree, force = false }) {
  return withLock(lockPath(commonDir), () => {
    const { claims, expired } = readClaims(commonDir);
    const claim = claims[id] ?? null;
    if (!claim) {
      if (expired.length) write(commonDir, claims);
      return { released: false, claim: null };
    }
    if (!force && !samePath(claim.worktree, worktree)) throw claimedError(id, claim);
    delete claims[id];
    write(commonDir, claims);
    return { released: true, claim };
  });
}
