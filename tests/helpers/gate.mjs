// Gate test support: a promoted gate in a temp DOCKET_HOME, the managed hook template, disposable bare
// remotes, and Git's own sh for running hook scripts directly.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defaultTemplatePath } from "../../src/integration/gate/install.mjs";
import { promoteDirectory } from "../../src/integration/gate/promote.mjs";
import { smokeGate } from "../../src/integration/gate/smoke.mjs";
import { ROOT, git, tempDir } from "./repository.mjs";

/**
 * The managed hook template: the harness copy, or DOCKET_HOOK_TEMPLATE. CI points that at the vendored
 * snapshot `tests/fixtures/hooks/pre-push.template.sh` (ADR-31) and sets DOCKET_REQUIRE_HOOK_TEMPLATE=1,
 * so a missing template fails the gate suites instead of skipping them.
 */
export const TEMPLATE = defaultTemplatePath();
export const VENDORED_TEMPLATE = path.join(
  ROOT,
  "tests",
  "fixtures",
  "hooks",
  "pre-push.template.sh",
);
export const templateAvailable = () => fs.existsSync(TEMPLATE);
if (process.env.DOCKET_REQUIRE_HOOK_TEMPLATE === "1" && !templateAvailable()) {
  throw new Error(`DOCKET_REQUIRE_HOOK_TEMPLATE=1 but no hook template at ${TEMPLATE}`);
}

/**
 * The managed template exactly as it was before the Docket callback (harness commit HEAD on
 * 2026-10-04), saved as a fixture so the un-opted compatibility test keeps running after the harness
 * commits the new template. DOCKET_HOOK_TEMPLATE_BASELINE overrides it.
 */
export function baselineTemplate() {
  const file =
    process.env.DOCKET_HOOK_TEMPLATE_BASELINE ||
    path.join(ROOT, "tests", "fixtures", "hooks", "pre-push.template.pre-docket.sh");
  return fs.readFileSync(file, "utf8");
}

/** Git for Windows' sh (what git uses to run hooks); plain `sh` elsewhere. */
export function gitSh() {
  if (process.platform !== "win32") return "sh";
  const exec = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
  return path.join(
    exec.replace(/[\\/]mingw64[\\/]libexec[\\/]git-core$/i, ""),
    "usr",
    "bin",
    "sh.exe",
  );
}

/** Promote the current checkout's src/ as a gate version into gateRoot (test-only shortcut). */
export function promoteCheckout(gateRoot, version = "test-checkout") {
  const { dir: staged, cleanup } = tempDir("docket-stage-");
  try {
    fs.cpSync(path.join(ROOT, "src"), path.join(staged, "src"), { recursive: true });
    fs.copyFileSync(path.join(ROOT, "package.json"), path.join(staged, "package.json"));
    return promoteDirectory({
      gateRoot,
      stagedDir: staged,
      version,
      entry: "src/integration/gate/pre-push.mjs",
      smoke: smokeGate,
    });
  } finally {
    cleanup();
  }
}

/** A bare remote next to the repo, registered as `origin`. */
export function addRemote(root, dir) {
  const remote = path.join(dir, "remote.git");
  git(dir, "init", "-q", "--bare", remote);
  git(root, "remote", "add", "origin", remote);
  return remote;
}

/** Fake git-lfs on PATH that logs its args to stderr and its stdin to $LFS_LOG. */
export function fakeLfs(dir) {
  const bin = path.join(dir, "fakebin");
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(bin, "git-lfs");
  fs.writeFileSync(script, '#!/bin/sh\necho "fake-lfs $1" >&2\ncat > "$LFS_LOG"\n');
  fs.chmodSync(script, 0o755);
  return { bin, log: path.join(dir, "lfs.log") };
}

/** Env with `bin` first on PATH, then the unwrapped git's dir so `git lfs` inside a hook finds `bin`. */
export function withPath(bin, env = {}) {
  const git = pushGit();
  const dirs = [bin, ...(path.isAbsolute(git) ? [path.dirname(git)] : []), process.env.PATH];
  return { ...process.env, ...env, PATH: dirs.join(path.delimiter) };
}

/**
 * The git executable to push with. On Windows, `git` on PATH is usually Git for Windows' cmd\git.exe
 * wrapper, which prepends its own mingw64\bin to the child PATH, so a real git-lfs bundled there beats
 * the fakeLfs stub placed first on PATH. mingw64\bin\git.exe leaves PATH alone, keeping the stub in
 * charge whatever Git or git-lfs the machine ships.
 */
export function pushGit() {
  if (process.platform !== "win32") return "git";
  const exec = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
  const plain = path.normalize(path.join(exec, "..", "..", "bin", "git.exe"));
  return fs.existsSync(plain) ? plain : "git";
}

/** `git push` with the hook active. Returns {status, stderr}. */
export function push(root, args, env = process.env) {
  const r = spawnSync(pushGit(), ["push", ...args], { cwd: root, env, encoding: "utf8" });
  return { status: r.status, stderr: r.stderr + r.stdout };
}

/** Run a hook script directly with Git's sh. Returns {status, stderr}. */
export function runHook(script, root, input, env = process.env) {
  const r = spawnSync(gitSh(), [script, "origin", "url"], {
    cwd: root,
    input,
    env,
    encoding: "utf8",
  });
  return { status: r.status, stderr: r.stderr };
}
