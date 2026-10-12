#!/usr/bin/env node
// Assemble the distributable: `npm pack` into dist/, then verify the tarball holds what the CLI and the
// gate need and nothing quarantined (bootstrap, tooling, tests, items). Prints the tarball path.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTarball } from "../integration/gate/tarball.mjs";

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
];
// The viewer was removed in 0.7.0 (ADR-29): its dependencies must not come back with the package.
const REMOVED_DEPENDENCIES = ["marked", "sanitize-html", "playwright"];
// docs/MOVE-IN.md (move-in playbook) and docs/AGENT-GUIDE.md (`docket guide`) ship; every other doc
// stays out. The removed viewer (src/viewer and its CLI command) must never ship again.
const FORBIDDEN =
  /^package\/(src\/bootstrap|src\/tooling|src\/viewer\/|src\/cli\/commands\/viewer\.mjs$|tests|docs\/(?!(MOVE-IN|AGENT-GUIDE)\.md$))/;

const dist = path.join(ROOT, "dist");
fs.mkdirSync(dist, { recursive: true });
const pack = spawnSync("npm", ["pack", "--pack-destination", "dist", "--json"], {
  cwd: ROOT,
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (pack.status !== 0) {
  console.error(pack.stderr);
  process.exit(1);
}
const [{ filename }] = JSON.parse(pack.stdout);
const tarball = path.join(dist, path.basename(filename));
const names = readTarball(fs.readFileSync(tarball)).map((f) => f.name);
const missing = REQUIRED.filter((r) => !names.includes(r));
const leaked = names.filter((n) => FORBIDDEN.test(n));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
const revived = REMOVED_DEPENDENCIES.filter((d) => declared[d]);
if (missing.length || leaked.length || revived.length) {
  for (const m of missing) console.error(`missing from tarball: ${m}`);
  for (const d of revived) console.error(`removed dependency declared again: ${d}`);
  for (const l of leaked) console.error(`must not ship: ${l}`);
  process.exit(1);
}
console.log(tarball);
