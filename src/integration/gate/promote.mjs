// Promotion: make a tested checker the last-good gate. A staged directory becomes an immutable
// versions/<version>/ copy, its launcher is refreshed, and active.json selects it (remembering the
// previous version for recovery).
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CODES, docketError } from "../../core/errors.mjs";
import { atomicWrite } from "../../storage/atomic-write.mjs";
import { defaultGateRoot, readActive } from "./paths.mjs";
import { smokeGate } from "./smoke.mjs";
import { extractTarball } from "./tarball.mjs";

const PRE_PUSH_ENTRY = "src/integration/gate/pre-push.mjs";
const strip = ({ version, dir, entry, promotedAt }) => ({ version, dir, entry, promotedAt });

/**
 * Promote a staged directory as `version`. Runs `smoke` against the staged copy first; on failure the
 * staging copy is removed and active.json is untouched, so the previous version stays selected.
 */
export function promoteDirectory({ gateRoot, stagedDir, version, entry, smoke }) {
  const versions = path.join(gateRoot, "versions");
  fs.mkdirSync(versions, { recursive: true });
  const dirName = `versions/${version}`;
  const finalDir = path.join(gateRoot, dirName);
  if (!fs.existsSync(finalDir)) {
    const staging = path.join(versions, `.staging-${randomBytes(4).toString("hex")}`);
    fs.cpSync(stagedDir, staging, { recursive: true });
    try {
      smoke(staging, entry);
      fs.renameSync(staging, finalDir);
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw err;
    }
  } else {
    smoke(finalDir, entry); // re-activating a retained version still has to pass
  }
  const launcher = path.join(finalDir, "src", "integration", "gate", "launcher.mjs");
  atomicWrite(path.join(gateRoot, "launcher.mjs"), fs.readFileSync(launcher));
  const previous = readActive(gateRoot);
  const active = {
    version,
    dir: dirName,
    entry,
    promotedAt: new Date().toISOString(),
    previous:
      previous && previous.version !== version ? strip(previous) : (previous?.previous ?? null),
  };
  atomicWrite(path.join(gateRoot, "active.json"), JSON.stringify(active, null, 2) + "\n");
  return active;
}

/** Promote an npm tarball of Docket. Version dir is `<package version>-<tarball sha256 prefix>`. */
export function promoteTarball(tarball, { gateRoot = defaultGateRoot(), smoke = smokeGate } = {}) {
  const bytes = fs.readFileSync(tarball);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "docket-promote-"));
  try {
    extractTarball(bytes, scratch, { strip: "package/" });
    const pkg = JSON.parse(fs.readFileSync(path.join(scratch, "package.json"), "utf8"));
    if (pkg.name !== "docket")
      throw docketError(CODES.BAD_TARBALL, `not a docket package: ${pkg.name}`);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    const version = `${pkg.version}-${hash}`;
    const checkVersion = (dir, entry) => {
      const out = execFileSync(
        process.execPath,
        [path.join(dir, "src/cli/main.mjs"), "--version"],
        {
          encoding: "utf8",
          windowsHide: true,
        },
      ).trim();
      if (out !== pkg.version) throw docketError(CODES.SMOKE, `--version printed ${out}`);
      smoke(dir, entry);
    };
    return promoteDirectory({
      gateRoot,
      stagedDir: scratch,
      version,
      entry: PRE_PUSH_ENTRY,
      smoke: checkVersion,
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
