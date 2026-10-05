// `docket init [--gate] [--dry-run]`: thin adapter over integration/init.mjs.
import { initRepo } from "../../integration/init.mjs";
import { parseCommand } from "../args.mjs";
import { gateReport, stateLine } from "../report.mjs";

export async function init(argv, io) {
  const args = parseCommand(argv, {
    options: { gate: { type: "boolean" }, "dry-run": { type: "boolean" } },
  });
  const dryRun = Boolean(args["dry-run"]);
  const result = initRepo(args.repo ?? io.cwd, { gate: Boolean(args.gate), dryRun });
  const lines = [
    dryRun
      ? `dry run, nothing written: ${result.root}`
      : result.initialised
        ? `docket initialised in ${result.root}`
        : `already initialised: ${result.root}`,
    ...result.files.map((f) => stateLine(f.path, f.state, dryRun)),
  ];
  if (result.gate) lines.push("gate:", ...gateReport(result.gate));
  return { data: result, text: lines.join("\n") };
}
