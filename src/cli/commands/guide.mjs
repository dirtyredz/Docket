// `docket guide`: print the shipped, tool-neutral agent guide (docs/AGENT-GUIDE.md in the package).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CODES, docketError } from "../../core/errors.mjs";
import { parseCommand } from "../args.mjs";

export const GUIDE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "docs",
  "AGENT-GUIDE.md",
);

export async function guide(argv) {
  parseCommand(argv);
  let text;
  try {
    text = fs.readFileSync(GUIDE_FILE, "utf8");
  } catch (err) {
    throw docketError(CODES.INTERNAL, `agent guide missing from this install: ${err.message}`);
  }
  return { data: { path: GUIDE_FILE, text }, text: text.trimEnd() };
}
