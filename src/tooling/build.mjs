#!/usr/bin/env node
// Assemble the distributable: `npm pack` into dist/, then verify the tarball holds what the CLI, the gate
// and headless library consumers need, and nothing quarantined (bootstrap, tooling, tests, items) or
// removed (the 0.7.0 viewer and its rendering dependencies). Prints the tarball path.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTarball } from "../integration/gate/tarball.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REQUIRED = [
  "package/package.json",
  "package/README.md",
  "package/src/cli/main.mjs",
  "package/src/integration/gate/launcher.mjs",
  "package/src/integration/gate/pre-push.mjs",
  "package/src/integration/agent-snippet.md",
  "package/src/integration/init.mjs",
  "package/src/cli/commands/init.mjs",
  "package/docs/MOVE-IN.md",
  "package/docs/AGENT-GUIDE.md",
  "package/docs/LIBRARY.md",
  "package/src/cli/commands/guide.mjs",
  "package/src/integration/agent-snippet.mjs",
];
// The viewer was removed in 0.7.0 (ADR-29): its dependencies must not come back with the package, and
// the headless library renders nothing (Command Deck owns Markdown and sanitizing).
export const REMOVED_DEPENDENCIES = ["marked", "sanitize-html", "playwright"];
// docs/MOVE-IN.md (move-in playbook), docs/AGENT-GUIDE.md (`docket guide`) and docs/LIBRARY.md (the
// library contract) ship; every other doc stays out. The removed viewer (src/viewer and its CLI command)
// must never ship again.
const FORBIDDEN =
  /^package\/(src\/bootstrap|src\/tooling|src\/viewer\/|src\/cli\/commands\/viewer\.mjs$|tests|docs\/(?!(MOVE-IN|AGENT-GUIDE|LIBRARY)\.md$))/;
// A library export names one src/library/ facade (or package.json): never an implementation module in
// core, state, repository or anywhere else (ADR-30), no root entry, no patterns, no `..` segments.
const EXPORT_TARGET = /^\.\/(package\.json|src\/library\/(?:[\w-]+\/)*[\w-]+\.mjs)$/;

/**
 * Problems with the packaged library contract: `pkg` is the PACKED package.json, `names` the tarball's
 * entry names. The export map must exist, have no catch-all ("." or a "*" pattern) and name only shipped
 * src/library/ facades (or package.json); no removed rendering dependency may be declared.
 */
export function libraryProblems(pkg, names) {
  const problems = [];
  const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  for (const d of REMOVED_DEPENDENCIES) {
    if (declared[d]) problems.push(`removed dependency declared again: ${d}`);
  }
  const exports = pkg.exports;
  if (!exports || typeof exports !== "object" || Array.isArray(exports)) {
    return [...problems, "package.json has no subpath export map"];
  }
  for (const [subpath, target] of Object.entries(exports)) {
    if (subpath === "." || !subpath.startsWith("./")) {
      problems.push(`export ${subpath}: no catch-all or root entry`);
    }
    if (subpath.includes("*") || String(target).includes("*")) {
      problems.push(`export ${subpath}: patterns are not allowed`);
    }
    if (typeof target !== "string" || !EXPORT_TARGET.test(target)) {
      problems.push(
        `export ${subpath}: target must be one shipped src/library/ facade, got ${target}`,
      );
    } else if (!names.includes(`package/${target.slice(2)}`)) {
      problems.push(`export ${subpath}: ${target} is not in the tarball`);
    }
  }
  return problems;
}

/** Every problem with a tarball's entries (`entries`: readTarball output). */
export function tarballProblems(entries) {
  const names = entries.map((f) => f.name);
  const problems = REQUIRED.filter((r) => !names.includes(r)).map(
    (m) => `missing from tarball: ${m}`,
  );
  problems.push(...names.filter((n) => FORBIDDEN.test(n)).map((l) => `must not ship: ${l}`));
  const packed = entries.find((f) => f.name === "package/package.json");
  if (packed) problems.push(...libraryProblems(JSON.parse(packed.data.toString("utf8")), names));
  return problems;
}

function main() {
  const dist = path.join(ROOT, "dist");
  fs.mkdirSync(dist, { recursive: true });
  const pack = spawnSync("npm", ["pack", "--pack-destination", "dist", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (pack.status !== 0) {
    console.error(pack.stderr);
    return 1;
  }
  const [{ filename }] = JSON.parse(pack.stdout);
  const tarball = path.join(dist, path.basename(filename));
  const problems = tarballProblems(readTarball(fs.readFileSync(tarball)));
  for (const p of problems) console.error(p);
  if (problems.length) return 1;
  console.log(tarball);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
