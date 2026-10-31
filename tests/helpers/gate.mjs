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

let execPathMemo;
/**
 * The install's own `git --exec-path` (as git prints it), resolved once. GIT_EXEC_PATH is dropped from the
 * probe so a test override never changes which install the layout is read from.
 */
export function gitExecPath() {
  if (execPathMemo === undefined) {
    const probeEnv = { ...process.env };
    delete probeEnv.GIT_EXEC_PATH;
    execPathMemo = execFileSync("git", ["--exec-path"], {
      encoding: "utf8",
      env: probeEnv,
    }).trim();
  }
  return execPathMemo;
}

/** Git for Windows' sh (what git uses to run hooks); plain `sh` elsewhere. */
export function gitSh() {
  if (process.platform !== "win32") return "sh";
  return path.join(
    gitExecPath().replace(/[\\/]mingw64[\\/]libexec[\\/]git-core$/i, ""),
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

/**
 * Env that makes `bin` (holding the fakeLfs stub) the git-lfs a hook runs, on any Git layout. `git lfs`
 * resolves the dashed `git-lfs` from git's exec-path BEFORE PATH, and a Git for Windows image may ship a
 * real git-lfs there, so PATH alone cannot win. GIT_EXEC_PATH=bin puts the stub first in both places; the
 * real exec-path and git directory follow on PATH so the hook still finds git-receive-pack, sh and friends.
 */
export function withPath(bin, extra = {}) {
  const git = pushGit();
  const dirs = [
    bin,
    gitExecPath(),
    ...(path.isAbsolute(git) ? [path.dirname(git)] : []),
    process.env.PATH,
  ];
  return { ...process.env, ...extra, GIT_EXEC_PATH: bin, PATH: dirs.join(path.delimiter) };
}

let pushGitMemo;
/**
 * The git executable to push with. On Windows, `git` on PATH is usually Git for Windows' cmd\git.exe
 * wrapper, which prepends its own mingw64\bin to the child PATH, so a real git-lfs bundled there beats
 * the fakeLfs stub placed first on PATH. mingw64\bin\git.exe leaves PATH alone. Falls back to plain `git`
 * with a stderr warning when that file is missing (a different layout), since the stub may then lose.
 */
export function pushGit() {
  if (process.platform !== "win32") return "git";
  if (pushGitMemo === undefined) {
    const plain = path.normalize(path.join(gitExecPath(), "..", "..", "bin", "git.exe"));
    if (fs.existsSync(plain)) pushGitMemo = plain;
    else {
      process.stderr.write(`gate helper: no unwrapped git at ${plain}; pushing with PATH git\n`);
      pushGitMemo = "git";
    }
  }
  return pushGitMemo;
}

/**
 * What a hook sees under the stub setup, for failure messages: the effective exec-path, the git-lfs that
 * `command -v` picks, and the PATH it gets, probed with git's own sh.
 */
export function describeLfsResolution(hookEnv) {
  const script =
    'echo "exec-path=$(git --exec-path)"; echo "command -v git-lfs=$(command -v git-lfs)"; echo "PATH=$PATH"';
  const probe = spawnSync(gitSh(), ["-c", script], { env: hookEnv, encoding: "utf8" });
  return `${probe.stdout}${probe.stderr}push git=${pushGit()} GIT_EXEC_PATH=${hookEnv.GIT_EXEC_PATH}`;
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
