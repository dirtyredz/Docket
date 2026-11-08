#!/usr/bin/env node
// Assemble the distributable: `npm pack` into dist/, then verify the tarball holds what the CLI, the
// gate and library consumers need and nothing quarantined (bootstrap, tooling, tests, items). Prints the
// tarball path.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTarball } from "../integration/gate/tarball.mjs";
import { ASSETS } from "../viewer/server/static.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REQUIRED = [
  "package/package.json",
  "package/src/cli/main.mjs",
  "package/src/integration/gate/launcher.mjs",
  "package/src/integration/gate/pre-push.mjs",
  "package/src/integration/agent-snippet.md",
  "package/src/integration/init.mjs",
  "package/src/cli/commands/init.mjs",
  "package/docs/MOVE-IN.md",
  "package/docs/AGENT-GUIDE.md",
  "package/src/cli/commands/guide.mjs",
  "package/src/integration/agent-snippet.mjs",
  "package/src/cli/commands/viewer.mjs",
  "package/src/viewer/server/main.mjs",
  "package/src/viewer/documents/render.mjs",
  ...ASSETS.map((a) => `package/src/viewer/ui/${a}`),
];
// The viewer's (and the `docket/markdown` export's) Markdown dependencies must be declared so
// `npm install <tgz>` brings them.
export const RUNTIME_DEPENDENCIES = ["marked", "sanitize-html"];
// docs/MOVE-IN.md (move-in playbook) and docs/AGENT-GUIDE.md (`docket guide`) ship; every other doc stays out.
const FORBIDDEN =
  /^package\/(src\/bootstrap|src\/tooling|tests|docs\/(?!(MOVE-IN|AGENT-GUIDE)\.md$))/;
// A library export names one shipped module (or package.json); no root entry, no patterns.
const EXPORT_TARGET = /^\.\/(package\.json|src\/(?!bootstrap\/|tooling\/)[\w./-]+\.mjs)$/;

/**
 * Problems with the packaged library contract: `pkg` is the PACKED package.json, `names` the tarball's
 * entry names. The export map must exist, have no catch-all ("." or a "*" pattern), name only shipped
 * modules, and the runtime dependencies must be declared.
 */
export function libraryProblems(pkg, names) {
  const problems = [];
  const exports = pkg.exports;
  if (!exports || typeof exports !== "object" || Array.isArray(exports)) {
    return ["package.json has no subpath export map"];
  }
  for (const [subpath, target] of Object.entries(exports)) {
    if (subpath === "." || !subpath.startsWith("./")) {
      problems.push(`export ${subpath}: no catch-all or root entry`);
    }
    if (subpath.includes("*") || String(target).includes("*")) {
      problems.push(`export ${subpath}: patterns are not allowed`);
    }
    if (typeof target !== "string" || !EXPORT_TARGET.test(target)) {
      problems.push(`export ${subpath}: target must be one shipped module, got ${target}`);
    } else if (!names.includes(`package/${target.slice(2)}`)) {
      problems.push(`export ${subpath}: ${target} is not in the tarball`);
    }
  }
  for (const d of RUNTIME_DEPENDENCIES) {
    if (!pkg.dependencies?.[d]) problems.push(`runtime dependency not declared: ${d}`);
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
