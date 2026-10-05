// Where the per-machine registry lives: <DOCKET_HOME or %LOCALAPPDATA%/Docket>/registry.json.
// Tests (and anyone who wants a separate registry) set DOCKET_HOME. There is no fallback into the
// current directory or the home folder: without an application-data location the registry is refused.
import path from "node:path";
import { CODES, docketError } from "../../core/errors.mjs";

export const REGISTRY_FILE = "registry.json";

/** Absolute path of registry.json for `env`. Throws DOCKET_USAGE when no location is configured. */
export function registryPath(env = process.env) {
  const home = env.DOCKET_HOME || (env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Docket"));
  if (!home || !path.isAbsolute(home)) {
    throw docketError(
      CODES.USAGE,
      "no application-data location: set LOCALAPPDATA or DOCKET_HOME to an absolute directory",
    );
  }
  return path.join(home, REGISTRY_FILE);
}
