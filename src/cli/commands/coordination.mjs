// `claim` and `release`: advisory work claims for the current worktree (shared by linked worktrees).
import { notFound } from "../../core/errors.mjs";
import { claimItem, releaseItem } from "../../state/claims/store.mjs";
import { currentBranch, resolveRepo } from "../../repository/context.mjs";
import { readItemFile } from "../../storage/item-store.mjs";
import { parseCommand, requirePositional } from "../args.mjs";

function requireItem(ctx, id) {
  if (!readItemFile(ctx, id)) throw notFound(id);
}

export async function claim(argv, io) {
  const args = parseCommand(argv, {
    positionals: 1,
    options: { takeover: { type: "boolean" }, agent: { type: "string" } },
  });
  const id = requirePositional(args, "id");
  const ctx = resolveRepo(args.repo ?? io.cwd);
  requireItem(ctx, id);
  const { claim: c, previous } = claimItem(ctx.commonDir, id, {
    worktree: ctx.root,
    branch: currentBranch(ctx.root),
    agent: args.agent ?? io.env?.DOCKET_AGENT ?? null,
    takeover: Boolean(args.takeover),
  });
  const tookOver = previous && previous.worktree !== c.worktree ? previous : null;
  return {
    data: { id, claim: c, tookOver },
    text: `${id}: claimed for ${c.worktree}${tookOver ? ` (taken over from ${tookOver.worktree})` : ""}`,
  };
}

export async function release(argv, io) {
  const args = parseCommand(argv, { positionals: 1, options: { force: { type: "boolean" } } });
  const id = requirePositional(args, "id");
  const ctx = resolveRepo(args.repo ?? io.cwd);
  const { released, claim: c } = releaseItem(ctx.commonDir, id, {
    worktree: ctx.root,
    force: Boolean(args.force),
  });
  return {
    data: { id, released, claim: c },
    text: released ? `${id}: released` : `${id}: was not claimed`,
  };
}
