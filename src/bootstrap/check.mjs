#!/usr/bin/env node
// Bootstrap adapter around the recovered prototype (quarantined; never imported by production code).
// It bridged Docket's own gate from M0 until the production checker passed its conformance suite.
//   node src/bootstrap/check.mjs --repo <dir>              validate the working tree
//   node src/bootstrap/check.mjs --repo <dir> --ref <rev>  validate docs/items/ as committed at <rev>
//   node src/bootstrap/check.mjs --repo <dir> --pre-push   validate every pushed tip read from stdin
// Self-contained on purpose: a promoted copy must run without the rest of the checkout.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkDir } from "./prototype-check.mjs";

const ZERO = /^0+$/;

function git(repo, args, input) {
  return execFileSync("git", args, {
    cwd: repo,
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// Copy docs/items/ blobs at <ref> into a scratch tree so the prototype can read them unchanged.
function materialize(repo, ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docket-bootstrap-"));
  const items = path.join(dir, "docs", "items");
  fs.mkdirSync(items, { recursive: true });
  const listing = git(repo, ["ls-tree", "-z", ref, "--", "docs/items/"]).toString("utf8");
  for (const entry of listing.split("\0").filter(Boolean)) {
    const [meta, name] = entry.split("\t");
    const [, kind, sha] = meta.split(" ");
    const base = path.posix.basename(name);
    if (kind !== "blob") fs.mkdirSync(path.join(items, base), { recursive: true });
    else fs.writeFileSync(path.join(items, base), git(repo, ["cat-file", "blob", sha]));
  }
  return dir;
}

function checkRef(repo, ref) {
  const dir = materialize(repo, ref);
  try {
    return checkDir(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  const opt = { repo: ".", ref: null, prePush: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo") opt.repo = argv[++i];
    else if (argv[i] === "--ref") opt.ref = argv[++i];
    else if (argv[i] === "--pre-push") opt.prePush = true;
  }
  const repo = path.resolve(opt.repo);
  const jobs = [];
  if (opt.prePush) {
    for (const line of fs.readFileSync(0, "utf8").split("\n")) {
      const [localRef, localSha] = line.trim().split(/\s+/);
      if (localSha && !ZERO.test(localSha)) jobs.push({ label: localRef, ref: localSha });
    }
  } else if (opt.ref) jobs.push({ label: opt.ref, ref: opt.ref });
  else jobs.push({ label: "working tree", ref: null });

  let failed = false;
  for (const job of jobs) {
    const errs = job.ref ? checkRef(repo, job.ref) : checkDir(repo);
    console.log(
      `bootstrap check (${job.label}): ${errs.length ? `${errs.length} error(s)` : "ok"}`,
    );
    for (const e of errs) console.log(`  ${e}`);
    failed ||= errs.length > 0;
  }
  return failed ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
