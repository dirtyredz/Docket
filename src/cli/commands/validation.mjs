// `docket check`: validate the working tree or, with --ref, the items committed at a Git revision.
import { formatCheck } from "../../core/validation/report.mjs";
import { checkStore } from "../../core/validation/store.mjs";
import { resolveRepo } from "../../repository/context.mjs";
import * as claims from "../../state/claims/store.mjs";
import { parseCommand } from "../args.mjs";
import { EXIT } from "../output.mjs";

export async function check(argv, io) {
  const args = parseCommand(argv, { options: { ref: { type: "string" } } });
  const result = checkStore(resolveRepo(args.repo ?? io.cwd), { ref: args.ref ?? null, claims });
  const { records: _records, warnings: _warnings, ...data } = result;
  return {
    data,
    text: formatCheck(result),
    warnings: result.warnings,
    exitCode: result.ok ? EXIT.ok : EXIT.failed,
  };
}
