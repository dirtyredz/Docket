// Smoke test of a gate version: the exact pre-push path, against a disposable repo.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CODES, docketError } from "../../core/errors.mjs";
import { git } from "../../repository/context.mjs";

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
    if (runEntry(file, repo, good) !== 0) throw docketError(CODES.SMOKE, "valid commit rejected");
    if (runEntry(file, repo, bad) === 0) throw docketError(CODES.SMOKE, "invalid commit accepted");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}
