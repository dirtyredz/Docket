#!/usr/bin/env node
// Pushed-ref validation, run by the launcher from a promoted (last-good) version:
//   node pre-push.mjs --repo <root> --pre-push     stdin: "<local ref> <local sha> <remote ref> <remote sha>"
// Every pushed local tip is validated as `docket check --ref` would (core checkStore), so a clean working
// tree cannot hide invalid committed items. Deleted refs (all-zero local sha) are skipped. Exit 1 if any tip fails.
import fs from "node:fs";
import { formatCheck, formatWarning } from "../../core/validation/report.mjs";
import { checkStore } from "../../core/validation/store.mjs";
import { resolveRepo } from "../../repository/context.mjs";
import * as claims from "../../state/claims/store.mjs";

const ZERO = /^0+$/;

/** Parse git's pre-push stdin into the tips to validate. */
export function pushedTips(input) {
  const tips = [];
  for (const line of input.split(/\r?\n/)) {
    const [localRef, localSha] = line.trim().split(/\s+/);
    if (!localRef || !localSha || ZERO.test(localSha)) continue;
    if (!tips.some((t) => t.sha === localSha)) tips.push({ ref: localRef, sha: localSha });
  }
  return tips;
}

export async function runPrePush(argv, io, input) {
  const i = argv.indexOf("--repo");
  const repo = i >= 0 ? argv[i + 1] : io.cwd;
  let failed = false;
  for (const tip of pushedTips(input)) {
    io.stderr.write(`docket gate: ${tip.ref}\n`);
    try {
      const result = checkStore(resolveRepo(repo), { ref: tip.sha, claims });
      // git shows hook stderr, so everything goes there
      io.stderr.write(`${formatCheck(result)}\n`);
      for (const w of result.warnings) io.stderr.write(`${formatWarning(w)}\n`);
      failed ||= !result.ok;
    } catch (err) {
      io.stderr.write(`docket check: ${err.message}\n`);
      failed = true;
    }
  }
  return failed ? 1 : 0;
}

if (process.argv.includes("--pre-push")) {
  const io = {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
  };
  process.exitCode = await runPrePush(process.argv.slice(2), io, fs.readFileSync(0, "utf8"));
}
