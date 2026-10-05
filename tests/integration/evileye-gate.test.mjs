// EvilEye's real installed push chain after the M2b cutover, proven on a disposable clone (never EvilEye's own
// remote): icon guard (core.hooksPath -> .git/evileye-hooks) -> EvilEye's physical managed pre-push hook ->
// LFS -> Docket's promoted last-good gate -> structure checks. A valid tip carrying the migrated store passes;
// an invalid committed item is rejected even though the working tree is clean.
// Opt-in: set DOCKET_EVILEYE_REPO to the EvilEye checkout (after `docket gate install --repo <EvilEye>`).
// The cutover may still be uncommitted there, so the clone commits EvilEye's working-tree store files.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { git, tempDir } from "../helpers/repository.mjs";

const EVILEYE = process.env.DOCKET_EVILEYE_REPO;
const skip = EVILEYE
  ? false
  : "set DOCKET_EVILEYE_REPO to run against EvilEye's installed hook chain";
const STORE = ["docket.json", "docs/items", "docs/records/migrations/docket.json"];
const BAD = "dk-0badc0de";

const run = (cwd, cmd, args, env = process.env) => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

describe("EvilEye gate on a disposable clone", { skip }, () => {
  const tmp = skip ? null : tempDir("docket evileye gate ");
  after(() => tmp?.cleanup());

  /** Shared clone (objects borrowed, nothing copied), sparse checkout of the hook tooling and the store. */
  function cloneWithChain() {
    const remote = path.join(tmp.dir, "remote.git");
    const clone = path.join(tmp.dir, "clone");
    // The bare remote already holds EvilEye's history, so a push carries only the new commits (no LFS upload).
    git(tmp.dir, "clone", "-q", "--bare", "--shared", EVILEYE, remote);
    git(tmp.dir, "clone", "-q", "--shared", "--no-checkout", EVILEYE, clone);
    git(clone, "remote", "set-url", "origin", remote);
    git(clone, "config", "user.email", "test@docket");
    git(clone, "config", "user.name", "test");
    git(clone, "config", "core.autocrlf", "false");
    // LFS objects stay in EvilEye's store (the icon guard hashes them; nothing is copied).
    git(clone, "config", "lfs.storage", path.join(EVILEYE, ".git", "lfs"));
    git(
      clone,
      "sparse-checkout",
      "set",
      "--no-cone",
      "/.gitattributes",
      "/tools/",
      "/docs/items/",
      "/docket.json",
      "/docs/records/migrations/",
    );
    git(clone, "checkout", "-q", "main");
    for (const rel of STORE) {
      fs.cpSync(path.join(EVILEYE, rel), path.join(clone, rel), { recursive: true });
    }
    // EvilEye's chain exactly: its physical managed hook, its Docket opt-in config, the icon guard composer.
    const gitDir = (root) => path.resolve(root, git(root, "rev-parse", "--git-common-dir").trim());
    fs.copyFileSync(
      path.join(gitDir(EVILEYE), "hooks", "pre-push"),
      path.join(gitDir(clone), "hooks", "pre-push"),
    );
    for (const key of ["docket.gateLauncher", "docket.gateNode"]) {
      git(clone, "config", key, git(EVILEYE, "config", "--get", key).trim());
    }
    const icon = run(clone, process.execPath, ["tools/build/content/icon-guard/hooks/install.mjs"]);
    assert.equal(icon.status, 0, icon.out);
    return { clone, remote };
  }

  const remoteHead = (remote) => git(remote, "rev-parse", "main").trim();

  test("a valid tip with the migrated store passes; an invalid committed item is rejected", () => {
    const { clone, remote } = cloneWithChain();
    assert.match(git(clone, "config", "--get", "core.hooksPath"), /evileye-hooks/);
    git(clone, "add", "-A", "--", ...STORE);
    git(clone, "commit", "-q", "-m", "test: migrated store");
    const good = git(clone, "rev-parse", "HEAD").trim();
    const ok = run(clone, "git", ["push", "origin", "main"]);
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.out, /docket check \(/);
    assert.equal(remoteHead(remote), good);

    const file = path.join(clone, "docs", "items", `${BAD}.md`);
    fs.writeFileSync(file, `---\nid: ${BAD}\n---\n# broken\n`);
    git(clone, "add", "--", `docs/items/${BAD}.md`);
    git(clone, "commit", "-q", "-m", "test: invalid item");
    fs.rmSync(file); // the working tree is clean of it; only the commit is bad
    const refused = run(clone, "git", ["push", "origin", "main"]);
    assert.notEqual(refused.status, 0, refused.out);
    assert.match(refused.out, new RegExp(`${BAD}\\.md`));
    assert.equal(remoteHead(remote), good, "the remote did not move");
  });
});
