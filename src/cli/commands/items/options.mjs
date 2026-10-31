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

// A core input error names its field (details.field, the message starting with it: "type must be
// ..."); the CLI shows the matching flag and exits as a usage error. `flags` maps field -> flag.
const FLAG_OF_FIELD = { type: "type", priority: "priority", status: "status", title: "title" };

export function flagNamed(run, flags = FLAG_OF_FIELD) {
  try {
    return run();
  } catch (err) {
    const field = err.details?.field;
    const flag = err.code === CODES.INVALID && Object.hasOwn(flags, field) ? flags[field] : null;
    if (flag) {
      const message = err.message.startsWith(`${field} `)
        ? err.message.slice(field.length)
        : `: ${err.message}`;
      throw usageError(`--${flag}${message}`);
    }
    throw err;
  }
}
