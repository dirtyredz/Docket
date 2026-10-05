// Where the last-good gate lives and what is selected in it. Layout under the gate root (default
// %LOCALAPPDATA%/Docket/gate):
//   versions/<version>/   immutable promoted copies       active.json   the selected last-good version
//   launcher.mjs          stable entry the hook runs (copied from the promoted version)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function defaultGateRoot(env = process.env) {
  const home = env.DOCKET_HOME || path.join(env.LOCALAPPDATA || os.homedir(), "Docket");
  return path.join(home, "gate");
}

export function readActive(gateRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(gateRoot, "active.json"), "utf8"));
  } catch {
    return null;
  }
}
