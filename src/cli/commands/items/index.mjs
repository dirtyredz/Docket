// `index` command: (re)build the item index cache and report its stats.
import { loadIndex } from "../../../state/index/build.mjs";
import { parseCommand } from "../../args.mjs";
import { bool, repoOf } from "./options.mjs";

export async function index(argv, io) {
  const args = parseCommand(argv, { options: { rebuild: bool } });
  const { stats } = loadIndex(repoOf(args, io), { rebuild: Boolean(args.rebuild) });
  return {
    data: stats,
    text: `index: ${stats.total} file(s), ${stats.parsed} parsed, ${stats.reused} reused, ${stats.removed} removed (cache ${stats.cache})`,
  };
}
