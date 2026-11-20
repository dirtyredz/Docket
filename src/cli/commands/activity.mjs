import { activity as readActivity } from "../../state/claims/work.mjs";
import { resolveRepo } from "../../repository/context.mjs";
import { many, parseCommand } from "../args.mjs";

export async function activity(argv, io) {
  const args = parseCommand(argv, { options: { id: { type: "string", multiple: true } } });
  const data = readActivity(resolveRepo(args.repo ?? io.cwd), { ids: many(args.id) });
  return {
    data,
    text: data.items
      .map(
        (i) => `${i.id}  ${i.branch ?? "unknown"}  ${i.unknownReason ?? `quiet ${i.quietDays}d`}`,
      )
      .join("\n"),
  };
}
