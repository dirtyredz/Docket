// Advisory claims shared by the linked worktrees of one clone: <git-common-dir>/docket-claims.json,
// guarded by its own lock (never the item lock), replaced atomically. A claim whose worktree path no
// longer exists expires on read and is dropped on the next write. Never committed.
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
    return data && typeof data.claims === "object" && data.claims ? data.claims : {};
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
  for (const [id, c] of Object.entries(readRaw(commonDir))) {
    if (c && typeof c.worktree === "string" && exists(c.worktree)) claims[id] = c;
    else expired.push(id);
  }
  return { claims, expired };
}

function write(commonDir, claims) {
  const sorted = Object.fromEntries(Object.entries(claims).sort(([a], [b]) => (a < b ? -1 : 1)));
  atomicWrite(
    claimsPath(commonDir),
    JSON.stringify({ version: 1, claims: sorted }, null, 2) + "\n",
  );
}

const claimedError = (id, holder) =>
  docketError(
    CODES.CLAIMED,
    `${id} is claimed by ${holder.worktree} (${holder.branch ?? "detached"})`,
    { id, holder },
  );

/**
 * Claim `id` for `worktree`. Re-claiming from the same worktree refreshes it. A live claim held by
 * another worktree is rejected unless `takeover`. Returns {claim, previous}.
 */
export function claimItem(
  commonDir,
  id,
  { worktree, branch = null, agent = null, takeover = false, now = new Date() },
) {
  return withLock(lockPath(commonDir), () => {
    const { claims } = readClaims(commonDir);
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
    write(commonDir, claims);
    return { claim, previous };
  });
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
