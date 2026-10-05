// Shared file/stdin reading for CLI commands (lenient UTF-8 and strict LF-only variants).
import fs from "node:fs";
import { usageError } from "./args.mjs";

/** Read a file, or all of stdin for "-" (the caller's stdin, UTF-8). */
export function readInput(file, what) {
  try {
    return fs.readFileSync(file === "-" ? 0 : file, "utf8");
  } catch (err) {
    throw usageError(`cannot read ${what} ${file === "-" ? "from stdin" : file}: ${err.message}`);
  }
}

/** Like readInput, but rejects invalid UTF-8 and CR characters instead of tolerating them. */
export function readStrictInput(file, what) {
  let bytes;
  try {
    bytes = fs.readFileSync(file === "-" ? 0 : file);
  } catch (err) {
    throw usageError(`cannot read ${what} ${file === "-" ? "from stdin" : file}: ${err.message}`);
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw usageError(`${what} is not valid UTF-8`);
  }
  if (text.includes("\r")) throw usageError(`${what} contains CR characters (use LF line endings)`);
  return text;
}
