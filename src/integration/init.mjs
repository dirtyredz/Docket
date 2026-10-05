// `docket init`: make the current repo a Docket repo. Idempotent: every step is skipped when already
// done, and a run that changes nothing reports `initialised: false`. The gate is opt-in (`gate: true`)
// and reuses the existing install logic. With `dryRun` nothing is written; the report is the same.
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG, writeConfig } from "../repository/config.mjs";
import { resolveRepo } from "../repository/context.mjs";
import { atomicWrite } from "../storage/atomic-write.mjs";
import { AGENT_FILES, ensureAgentSnippets } from "./agent-snippet.mjs";
import { installRepo } from "./gate/install.mjs";

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

/** Each step returns "created" | "updated" | "unchanged" and writes nothing when `dryRun` is true. */
function ensureItemsDir(ctx, dryRun) {
  if (fs.existsSync(ctx.itemsDir)) return "unchanged";
  if (!dryRun) fs.mkdirSync(ctx.itemsDir, { recursive: true });
  return "created";
}

function ensureConfig(ctx, dryRun) {
  if (fs.existsSync(ctx.configPath)) return "unchanged";
  if (!dryRun) writeConfig(ctx, DEFAULT_CONFIG);
  return "created";
}

function ensureIgnore(ctx, dryRun) {
  const file = path.join(ctx.root, ".gitignore");
  const text = read(file);
  if ((text ?? "").split(/\r?\n/).some((l) => /^\/?\.docket\/?$/.test(l.trim())))
    return "unchanged";
  if (!dryRun) {
    const base = text ?? "";
    const eol = base.includes("\r\n") ? "\r\n" : "\n";
    const sep = base === "" || base.endsWith("\n") ? "" : eol;
    atomicWrite(file, `${base}${sep}.docket/${eol}`);
  }
  return text === null ? "created" : "updated";
}

/** True when the repo root configures Prettier: a config file, a package.json key, or a dependency. */
function usesPrettier(ctx) {
  const entries = fs.readdirSync(ctx.root);
  if (entries.some((n) => /^\.prettierrc(\..+)?$/.test(n) || /^prettier\.config\..+$/.test(n)))
    return true;
  try {
    const pkg = JSON.parse(read(path.join(ctx.root, "package.json")) ?? "null");
    return Boolean(pkg?.prettier || pkg?.devDependencies?.prettier || pkg?.dependencies?.prettier);
  } catch {
    return false;
  }
}

/**
 * Prettier re-wraps item files (a blank line after the frontmatter) on every commit, so a Prettier repo
 * lists `docs/items/` in `.prettierignore`. Returns null (no entry in the report) when Prettier is absent.
 */
function ensurePrettierIgnore(ctx, dryRun) {
  if (!usesPrettier(ctx)) return null;
  const file = path.join(ctx.root, ".prettierignore");
  const text = read(file);
  if ((text ?? "").split(/\r?\n/).some((l) => /^\/?docs\/items(\/(\*\*)?)?$/.test(l.trim())))
    return { path: ".prettierignore", state: "unchanged" };
  if (!dryRun) {
    const base = text ?? "";
    const eol = base.includes("\r\n") ? "\r\n" : "\n";
    const sep = base === "" || base.endsWith("\n") ? "" : eol;
    atomicWrite(file, `${base}${sep}docs/items/${eol}`);
  }
  return { path: ".prettierignore", state: text === null ? "created" : "updated" };
}

/**
 * Initialise the repo containing `start`. Returns {root, dryRun, initialised, created: string[] (paths
 * that are new or changed), files: [{path, state, reason?}], agentFiles, review, gate}. Throws
 * DOCKET_NOT_A_REPO outside a git worktree (resolveRepo). The managed agent snippet goes into both
 * CLAUDE.md and AGENTS.md (created when missing; older snippets upgraded in place, see
 * agent-snippet.mjs); `agentSnippet: false` touches neither. state "manual-review" is not a change.
 */
export function initRepo(
  start,
  { gate = false, dryRun = false, agentSnippet = true, gateOptions = {} } = {},
) {
  const ctx = resolveRepo(start);
  const files = [
    { path: "docs/items/", state: ensureItemsDir(ctx, dryRun) },
    { path: "docket.json", state: ensureConfig(ctx, dryRun) },
    { path: ".gitignore", state: ensureIgnore(ctx, dryRun) },
    ...(agentSnippet ? ensureAgentSnippets(ctx.root, { dryRun }) : []),
  ];
  const prettier = ensurePrettierIgnore(ctx, dryRun);
  if (prettier) files.push(prettier);
  const changed = files.filter((f) => f.state !== "unchanged" && f.state !== "manual-review");
  const agentFiles = changed.map((f) => f.path).filter((n) => AGENT_FILES.includes(n));
  const gateResult = gate ? installRepo(ctx.root, { ...gateOptions, dryRun }) : null;
  return {
    root: ctx.root,
    dryRun,
    initialised: changed.length > 0,
    created: changed.map((f) => f.path),
    files,
    agentFiles,
    review: files.filter((f) => f.state === "manual-review"),
    agentSnippet,
    gate: gateResult,
  };
}
