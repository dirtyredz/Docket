// Shared item-flag helpers: option specs, repo resolution, enum checks, core-error-to-flag mapping.
import { CODES } from "../../../core/errors.mjs";
import { resolveRepo } from "../../../repository/context.mjs";
import { usageError } from "../../args.mjs";

export const str = { type: "string" };
export const repeat = { type: "string", multiple: true };
export const bool = { type: "boolean" };

export const repoOf = (args, io) => resolveRepo(args.repo ?? io.cwd);

export function checkEnum(name, values, allowed) {
  for (const v of values) {
    if (!allowed.includes(v)) throw usageError(`--${name} must be one of ${allowed.join(", ")}`);
  }
  return values;
}

// Core names the field ("type must be ..."); the CLI shows the flag and exits as a usage error.
export function flagNamed(run) {
  try {
    return run();
  } catch (err) {
    if (err.code === CODES.INVALID && /^(type|priority|status|title) must /.test(err.message)) {
      throw usageError(`--${err.message}`);
    }
    throw err;
  }
}
