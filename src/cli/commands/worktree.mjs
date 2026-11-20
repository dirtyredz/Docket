import path from "node:path";
import { releaseWorktree } from "../../state/claims/work.mjs";
import { resolveRepo } from "../../repository/context.mjs";
import { parseCommand, usageError } from "../args.mjs";

export async function worktree(argv, io) {
  const [command, ...rest] = argv;
  if (command !== "release") throw usageError("expected worktree release --path <path>");
  const args = parseCommand(rest, { options: { path: { type: "string" } } });
  if (!args.path) throw usageError("missing --path");
  const data = releaseWorktree(resolveRepo(args.repo ?? io.cwd), path.resolve(io.cwd, args.path));
  return { data, text: `${data.count} item(s): work stopped` };
}
