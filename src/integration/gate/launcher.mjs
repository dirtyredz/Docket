#!/usr/bin/env node
// Stable gate launcher. Installed as <gate home>/launcher.mjs and invoked by the managed pre-push hook:
//   node launcher.mjs <repo root> [<remote> <url>]   (stdin: git's pre-push ref lines)
// It resolves the last-good version named in <gate home>/active.json and runs that version's entry with
// `--repo <root> --pre-push`, stdin passed through. It never runs a build or anything from the checkout.
// Self-contained on purpose (node built-ins only): it is copied out of the package on promotion.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gateHome = path.dirname(fileURLToPath(import.meta.url));

function fail(message) {
  console.error(`  docket gate: ${message}`);
  console.error(
    "     Recover: docket gate promote <tested tarball>; bypass once: git push --no-verify",
  );
  return 1;
}

function main([root]) {
  if (!root) return fail("usage: launcher.mjs <repo root> [remote url]");
  let active;
  try {
    active = JSON.parse(fs.readFileSync(path.join(gateHome, "active.json"), "utf8"));
  } catch (err) {
    return fail(`no usable active.json in ${gateHome} (${err.code ?? err.message})`);
  }
  const entry = path.resolve(gateHome, active.dir ?? "", active.entry ?? "");
  if (!active.dir || !active.entry || !fs.existsSync(entry)) {
    return fail(`active version ${active.version ?? "?"} has no entry at ${entry}`);
  }
  const run = spawnSync(process.execPath, [entry, "--repo", root, "--pre-push"], {
    stdio: "inherit",
  });
  if (run.error) return fail(`could not start ${entry}: ${run.error.message}`);
  return run.status ?? 1;
}

process.exitCode = main(process.argv.slice(2));
