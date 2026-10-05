// `docket init [--gate]`: thin adapter over integration/init.mjs.
import { initRepo } from "../../integration/init.mjs";
import { parseCommand } from "../args.mjs";

export async function init(argv, io) {
  const args = parseCommand(argv, { options: { gate: { type: "boolean" } } });
  const result = initRepo(args.repo ?? io.cwd, { gate: Boolean(args.gate) });
  const lines = result.initialised
    ? [
        `docket initialised in ${result.root}`,
        ...result.created.map((c) => `  created/updated ${c}`),
      ]
    : [`already initialised: ${result.root}`];
  if (result.gate) lines.push(`gate installed: hook ${result.gate.hook.state}`);
  return { data: result, text: lines.join("\n") };
}
