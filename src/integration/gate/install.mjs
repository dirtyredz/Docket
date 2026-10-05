// Gate installation: promote a tested checker into the last-good store, and opt a repo's managed
// pre-push hook into it. Layout under the gate root (default %LOCALAPPDATA%/Docket/gate):
//   versions/<version>/   immutable promoted copies       active.json   the selected last-good version
//   launcher.mjs          stable entry the hook runs (copied from the promoted version)
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { git, resolveRepo, tryGit } from "../../repository/context.mjs";
import { atomicWrite } from "../../storage/atomic-write.mjs";
import { extractTarball } from "./tarball.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRE_PUSH_ENTRY = "src/integration/gate/pre-push.mjs";
const MANAGED_MARKERS = ["structure-gate: managed hook", ".structure-review-pending"];
const slash = (p) => p.split(path.sep).join("/");
const gateError = (code, message) => Object.assign(new Error(message), { code });

export function defaultGateRoot(env = process.env) {
  const home = env.DOCKET_HOME || path.join(env.LOCALAPPDATA || os.homedir(), "Docket");
  return path.join(home, "gate");
}

export function defaultTemplatePath(env = process.env) {
  return (
    env.DOCKET_HOOK_TEMPLATE ||
    path.join(os.homedir(), ".claude", "hooks", "structure", "pre-push.template.sh")
  );
}

export function readActive(gateRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(gateRoot, "active.json"), "utf8"));
  } catch {
    return null;
  }
}

// --- smoke test: the exact pre-push path, against a disposable repo -------------------------------

const VALID_ITEM = (id) =>
  `---\nid: ${id}\ntype: task\ncreated: 2026-01-01\nstatus: todo\nsince: 2026-01-01\narea:\n` +
  `priority: P2\nrank: n\nparent:\nfixes: []\nblocked_by: []\nrelates: []\n---\n# Smoke item\n`;

function runEntry(entry, repo, sha) {
  try {
    execFileSync(process.execPath, [entry, "--repo", repo, "--pre-push"], {
      input: `refs/heads/main ${sha} refs/heads/main ${"0".repeat(40)}\n`,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
}

/** A valid commit must pass and an invalid one must fail through `entry --pre-push`. */
export function smokeGate(versionDir, entry) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "docket-smoke-"));
  try {
    const run = (...args) => git(repo, args);
    run("init", "-q", "-b", "main");
    run("config", "user.email", "smoke@docket");
    run("config", "user.name", "smoke");
    run("config", "core.autocrlf", "false");
    fs.mkdirSync(path.join(repo, "docs", "items"), { recursive: true });
    fs.writeFileSync(path.join(repo, "docs", "items", "dk-0000aaaa.md"), VALID_ITEM("dk-0000aaaa"));
    run("add", "-A");
    run("commit", "-q", "-m", "valid");
    const good = run("rev-parse", "HEAD").trim();
    fs.writeFileSync(path.join(repo, "docs", "items", "dk-0000bbbb.md"), "no frontmatter\n");
    run("add", "-A");
    run("commit", "-q", "-m", "invalid");
    const bad = run("rev-parse", "HEAD").trim();
    const file = path.join(versionDir, entry);
    if (runEntry(file, repo, good) !== 0) throw gateError("DOCKET_SMOKE", "valid commit rejected");
    if (runEntry(file, repo, bad) === 0) throw gateError("DOCKET_SMOKE", "invalid commit accepted");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

// --- promotion ------------------------------------------------------------------------------------

/**
 * Promote a staged directory as `version`. Runs `smoke` against the staged copy first; on failure the
 * staging copy is removed and active.json is untouched, so the previous version stays selected.
 */
export function promoteDirectory({ gateRoot, stagedDir, version, entry, launcherSource, smoke }) {
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
  const launcher =
    launcherSource ?? path.join(finalDir, "src", "integration", "gate", "launcher.mjs");
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

const strip = ({ version, dir, entry, promotedAt }) => ({ version, dir, entry, promotedAt });

/** Promote an npm tarball of Docket. Version dir is `<package version>-<tarball sha256 prefix>`. */
export function promoteTarball(tarball, { gateRoot = defaultGateRoot(), smoke = smokeGate } = {}) {
  const bytes = fs.readFileSync(tarball);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "docket-promote-"));
  try {
    extractTarball(bytes, scratch, { strip: "package/" });
    const pkg = JSON.parse(fs.readFileSync(path.join(scratch, "package.json"), "utf8"));
    if (pkg.name !== "docket")
      throw gateError("DOCKET_BAD_TARBALL", `not a docket package: ${pkg.name}`);
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
      if (out !== pkg.version) throw gateError("DOCKET_SMOKE", `--version printed ${out}`);
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

/** Promote the quarantined bootstrap checker (M0 bridge) from a checkout's src/bootstrap/. */
export function promoteBootstrap(checkoutRoot, { gateRoot = defaultGateRoot() } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "docket-bootstrap-"));
  try {
    fs.cpSync(path.join(checkoutRoot, "src", "bootstrap"), path.join(scratch, "src", "bootstrap"), {
      recursive: true,
    });
    const files = ["prototype-check.mjs", "check.mjs"].map((f) =>
      fs.readFileSync(path.join(scratch, "src", "bootstrap", f)),
    );
    const hash = createHash("sha256").update(Buffer.concat(files)).digest("hex").slice(0, 8);
    return promoteDirectory({
      gateRoot,
      stagedDir: scratch,
      version: `bootstrap-${hash}`,
      entry: "src/bootstrap/check.mjs",
      launcherSource: path.join(HERE, "launcher.mjs"),
      smoke: smokeGate,
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// --- repo opt-in ------------------------------------------------------------------------------------

const isManaged = (text) => MANAGED_MARKERS.some((m) => text.includes(m));

/**
 * Opt `repo` into the last-good gate: local git config docket.gateLauncher / docket.gateNode, and the
 * managed pre-push hook refreshed from the template. Foreign hooks and core.hooksPath are never
 * modified; their state is reported so the owner can wire delegation.
 */
export function installRepo(
  repo,
  {
    gateRoot = defaultGateRoot(),
    templatePath = defaultTemplatePath(),
    nodePath = process.execPath,
  } = {},
) {
  const ctx = resolveRepo(repo);
  const active = readActive(gateRoot);
  const launcher = path.join(gateRoot, "launcher.mjs");
  if (!active || !fs.existsSync(launcher)) {
    throw gateError(
      "DOCKET_GATE_NOT_PROMOTED",
      `no promoted gate in ${gateRoot}; run docket gate promote <tarball>`,
    );
  }
  let template;
  try {
    template = fs.readFileSync(templatePath, "utf8");
  } catch {
    throw gateError("DOCKET_TEMPLATE_MISSING", `managed hook template not found: ${templatePath}`);
  }
  if (!template.includes("docket.gateLauncher")) {
    throw gateError("DOCKET_TEMPLATE_TOO_OLD", `${templatePath} has no Docket callback`);
  }
  git(ctx.root, ["config", "--local", "docket.gateLauncher", slash(launcher)]);
  git(ctx.root, ["config", "--local", "docket.gateNode", slash(nodePath)]);

  const hookFile = path.join(ctx.commonDir, "hooks", "pre-push");
  let state;
  let current = null;
  try {
    current = fs.readFileSync(hookFile, "utf8");
  } catch {
    /* absent */
  }
  if (current === null || (isManaged(current) && current !== template)) {
    fs.mkdirSync(path.dirname(hookFile), { recursive: true });
    atomicWrite(hookFile, template);
    try {
      fs.chmodSync(hookFile, 0o755);
    } catch {
      /* no-op on Windows */
    }
    state = current === null ? "installed" : "updated";
  } else state = isManaged(current) ? "current" : "foreign";

  return {
    launcher: slash(launcher),
    node: slash(nodePath),
    hook: { path: slash(hookFile), state },
    hooksPath: hooksPathState(ctx),
    active,
  };
}

// core.hooksPath redirects git away from .git/hooks; report whether the active hook still reaches ours.
function hooksPathState(ctx) {
  const configured = tryGit(ctx.root, ["config", "--get", "core.hooksPath"]);
  if (!configured) return null;
  const dir = path.resolve(ctx.root, configured);
  if (path.resolve(dir) === path.resolve(ctx.commonDir, "hooks")) return null;
  let reaches = false;
  try {
    const text = fs.readFileSync(path.join(dir, "pre-push"), "utf8");
    reaches =
      /hooks\/pre-push/.test(text) || text.includes("docket.gateLauncher") || isManaged(text);
  } catch {
    /* no active pre-push */
  }
  return { path: slash(dir), reaches };
}

export function gateStatus(repo, { gateRoot = defaultGateRoot() } = {}) {
  const active = readActive(gateRoot);
  let versions = [];
  try {
    versions = fs.readdirSync(path.join(gateRoot, "versions")).filter((d) => !d.startsWith("."));
  } catch {
    /* none */
  }
  let optedIn = null;
  if (repo) {
    const ctx = resolveRepo(repo);
    optedIn = tryGit(ctx.root, ["config", "--get", "docket.gateLauncher"]);
  }
  return { gateRoot: slash(gateRoot), active, versions, repoLauncher: optedIn };
}
