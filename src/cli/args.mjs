// Argument handling. Every command accepts --repo and --json; each declares its own extra options.
import { parseArgs } from "node:util";
import { CODES, docketError } from "../core/errors.mjs";

export const COMMON_OPTIONS = Object.freeze({
  repo: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
});

export const usageError = (message) => docketError(CODES.USAGE, message);

/** Parse argv for one command. Unknown options and stray positionals raise DOCKET_USAGE. */
export function parseCommand(argv, { options = {}, positionals = 0 } = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { ...COMMON_OPTIONS, ...options },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    throw usageError(err.message);
  }
  if (parsed.positionals.length > positionals) {
    throw usageError(`unexpected argument: ${parsed.positionals[positionals]}`);
  }
  return { ...parsed.values, _: parsed.positionals };
}

/** First positional, required. */
export function requirePositional(args, name) {
  const value = args._[0];
  if (!value) throw usageError(`missing <${name}>`);
  return value;
}

/** Normalise a repeatable option (undefined, string or array) to an array. */
export const many = (value) => (value === undefined ? [] : [].concat(value));
