#!/usr/bin/env node
// Assemble the distributable: `npm pack` into dist/, then verify the tarball holds what the CLI and the
// gate need and nothing quarantined (bootstrap, tooling, tests, items). Prints the tarball path.
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
  "package/src/cli/commands/viewer.mjs",
  "package/src/viewer/server/main.mjs",
  "package/src/viewer/documents/render.mjs",
  ...ASSETS.map((a) => `package/src/viewer/ui/${a}`),
];
// The viewer's Markdown dependencies must be declared so `npm install <tgz>` brings them.
const RUNTIME_DEPENDENCIES = ["marked", "sanitize-html"];
// docs/MOVE-IN.md is the one shipped playbook; every other doc stays out.
const FORBIDDEN = /^package\/(src\/bootstrap|src\/tooling|tests|docs\/(?!MOVE-IN\.md$))/;

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
const undeclared = RUNTIME_DEPENDENCIES.filter((d) => !pkg.dependencies?.[d]);
if (missing.length || leaked.length || undeclared.length) {
  for (const m of missing) console.error(`missing from tarball: ${m}`);
  for (const d of undeclared) console.error(`runtime dependency not declared: ${d}`);
  for (const l of leaked) console.error(`must not ship: ${l}`);
  process.exit(1);
}
console.log(tarball);
