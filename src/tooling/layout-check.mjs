#!/usr/bin/env node
// Verify declared placement and file size: every code file under src/ and tests/ lives in a home
// declared in STRUCTURE.md `## Layout`, and no code file exceeds MAX_LINES.
//   node src/tooling/layout-check.mjs [--repo <dir>]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_LINES = 800;
const CODE = /\.(mjs|js|cjs)$/;

/** Declared homes from the `## Layout` section: ["src/core/format", ...] without trailing slash. */
export function declaredHomes(structureText) {
  const section = structureText.split(/^## /m).find((s) => s.startsWith("Layout"));
  if (!section) return [];
  return [...section.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1].replace(/\/$/, ""));
}

/** Problems for a list of repo-relative paths. readLines(file) returns the line count. */
export function layoutProblems(files, homes, readLines) {
  const problems = [];
  const homeSet = new Set(homes);
  for (const file of files) {
    if (!CODE.test(file) || !/^(src|tests)\//.test(file)) continue;
    const dir = path.posix.dirname(file);
    // With `tests` declared, a suite folder (tests/<suite>) and the unit areas under tests/unit/ are homes.
    const testsSuite =
      homeSet.has("tests") && (dir.split("/").length === 2 || dir.startsWith("tests/unit/"));
    if (!homeSet.has(dir) && !testsSuite) problems.push(`${file}: not in a declared Layout home`);
    const lines = readLines(file);
    if (lines > MAX_LINES) problems.push(`${file}: ${lines} lines (cap ${MAX_LINES})`);
  }
  return problems;
}

const PURE_STORE = "src/state/claims/store.mjs";
const LEAF_CORE = new Set(["core/errors.mjs"]);

/** The claims store is pure persistence: no core/items or item-mutation imports or callbacks. */
export function storePurityProblems(text, file = PURE_STORE) {
  const problems = [];
  for (const m of text.matchAll(/\bfrom\s+"([^"]+)"/g)) {
    const spec = m[1].replace(/^(\.\.\/)+/, "");
    if (/(^|\/)core\//.test(spec) && !LEAF_CORE.has(spec.replace(/^.*?(core\/)/, "$1"))) {
      problems.push(`${file}: imports ${m[1]} (only core/errors.mjs is allowed)`);
    }
  }
  if (/\benterWip\b|\bmutateStore\b/.test(text)) {
    problems.push(`${file}: item-mutation callback in the persistence layer`);
  }
  return problems;
}

function main(argv) {
  const i = argv.indexOf("--repo");
  const root = path.resolve(i >= 0 ? argv[i + 1] : ".");
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter((f) => f && fs.existsSync(path.join(root, f)));
  const homes = declaredHomes(fs.readFileSync(path.join(root, "STRUCTURE.md"), "utf8"));
  const count = (f) => fs.readFileSync(path.join(root, f), "utf8").split("\n").length;
  const problems = layoutProblems(files, homes, count);
  if (fs.existsSync(path.join(root, PURE_STORE))) {
    const text = fs.readFileSync(path.join(root, PURE_STORE), "utf8");
    problems.push(...storePurityProblems(text));
  }
  for (const p of problems) console.log(p);
  console.log(
    `layout check: ${problems.length ? `${problems.length} problem(s)` : "ok"} (${homes.length} homes)`,
  );
  return problems.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
