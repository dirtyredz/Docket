// Repo opt-in to the last-good gate: local git config pointing at the promoted launcher, and the
// managed pre-push hook refreshed from the harness template. Promotion lives in promote.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CODES, docketError } from "../../core/errors.mjs";
import { git, resolveRepo, tryGit } from "../../repository/context.mjs";
import { toSlash } from "../../repository/paths.mjs";
import { atomicWrite } from "../../storage/atomic-write.mjs";
import { defaultGateRoot, readActive } from "./paths.mjs";

const MANAGED_MARKERS = ["structure-gate: managed hook", ".structure-review-pending"];

export function defaultTemplatePath(env = process.env) {
  return (
    env.DOCKET_HOOK_TEMPLATE ||
    path.join(os.homedir(), ".claude", "hooks", "structure", "pre-push.template.sh")
  );
}

const isManaged = (text) => MANAGED_MARKERS.some((m) => text.includes(m));

/**
 * Opt `repo` into the last-good gate: local git config docket.gateLauncher / docket.gateNode, and the
 * managed pre-push hook refreshed from the template. `dryRun` computes the same report and writes nothing. Foreign hooks and core.hooksPath are never
 * modified; their state is reported so the owner can wire delegation.
 */
export function installRepo(
  repo,
  {
    gateRoot = defaultGateRoot(),
    templatePath = defaultTemplatePath(),
    nodePath = process.execPath,
    dryRun = false,
  } = {},
) {
  const ctx = resolveRepo(repo);
  const active = readActive(gateRoot);
  const launcher = path.join(gateRoot, "launcher.mjs");
  if (!active || !fs.existsSync(launcher)) {
    throw docketError(
      CODES.GATE_NOT_PROMOTED,
      `no promoted gate in ${gateRoot}; run docket gate promote <tarball>`,
    );
  }
  let template;
  try {
    template = fs.readFileSync(templatePath, "utf8");
  } catch {
    throw docketError(CODES.TEMPLATE_MISSING, `managed hook template not found: ${templatePath}`);
  }
  if (!template.includes("docket.gateLauncher")) {
    throw docketError(CODES.TEMPLATE_TOO_OLD, `${templatePath} has no Docket callback`);
  }
  const config = [
    setConfig(ctx, "docket.gateLauncher", toSlash(launcher), dryRun),
    setConfig(ctx, "docket.gateNode", toSlash(nodePath), dryRun),
  ];

  const hookFile = path.join(ctx.commonDir, "hooks", "pre-push");
  let state;
  let current = null;
  try {
    current = fs.readFileSync(hookFile, "utf8");
  } catch {
    /* absent */
  }
  if (current === null || (isManaged(current) && current !== template)) {
    if (!dryRun) {
      fs.mkdirSync(path.dirname(hookFile), { recursive: true });
      atomicWrite(hookFile, template);
      try {
        fs.chmodSync(hookFile, 0o755);
      } catch {
        /* no-op on Windows */
      }
    }
    state = current === null ? "installed" : "updated";
  } else state = isManaged(current) ? "current" : "foreign";

  return {
    dryRun,
    config,
    launcher: toSlash(launcher),
    node: toSlash(nodePath),
    hook: { path: toSlash(hookFile), state },
    hooksPath: hooksPathState(ctx),
    active,
  };
}

// Set a local git config key unless it already has that value. Returns {key, value, state}.
function setConfig(ctx, key, value, dryRun) {
  const current = tryGit(ctx.root, ["config", "--local", "--get", key]);
  if (current === value) return { key, value, state: "unchanged" };
  if (!dryRun) git(ctx.root, ["config", "--local", key, value]);
  return { key, value, state: current ? "updated" : "created" };
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
  return { path: toSlash(dir), reaches };
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
  return { gateRoot: toSlash(gateRoot), active, versions, repoLauncher: optedIn };
}
