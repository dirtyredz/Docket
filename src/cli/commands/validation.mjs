// `docket check`: validate the working tree or, with --ref, the items committed at a Git revision.
import { readClaims } from "../../claims/store.mjs";
import { localDate } from "../../core/identity/date.mjs";
import { checkSnapshot } from "../../core/validation/check.mjs";
import { resolveRepo } from "../../repository/context.mjs";
import { refSnapshot, workingSnapshot } from "../../repository/snapshot.mjs";
import { parseCommand } from "../args.mjs";
import { EXIT } from "../output.mjs";

const line = (e) => `  ${e.file}: [${e.rule}] ${e.message}${e.line ? ` (line ${e.line})` : ""}`;

function runCheck({ repo, ref = null, today = localDate() }) {
  const ctx = resolveRepo(repo);
  const snapshot = ref ? refSnapshot(ctx, ref) : workingSnapshot(ctx);
  const claimedIds = new Set(Object.keys(readClaims(ctx.commonDir).claims));
  return checkSnapshot(snapshot, { today, claimedIds });
}

function formatCheck(result) {
  const head = `docket check (${result.source}): ${result.count} item file(s), ${result.errors.length} error(s), ${result.warnings.length} warning(s)`;
  return [head, ...result.errors.map(line)].join("\n");
}

export async function check(argv, io) {
  const args = parseCommand(argv, { options: { ref: { type: "string" } } });
  const result = runCheck({ repo: args.repo ?? io.cwd, ref: args.ref ?? null });
  const { records: _records, warnings: _warnings, ...data } = result;
  return {
    data,
    text: formatCheck(result),
    warnings: result.warnings,
    exitCode: result.ok ? EXIT.ok : EXIT.failed,
  };
}
