// `docket init`: make the current repo a Docket repo. Idempotent: every step is skipped when already
// done, and a run that changes nothing reports `initialised: false`. The gate is opt-in (`gate: true`)
// and reuses the existing install logic. With `dryRun` nothing is written; the report is the same.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, writeConfig } from "../repository/config.mjs";
import { resolveRepo } from "../repository/context.mjs";
import { atomicWrite } from "../storage/atomic-write.mjs";
import { installRepo } from "./gate/install.mjs";

const SNIPPET_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "agent-snippet.md");
/** First line of the snippet; its presence in an agent file means the snippet is already there. */
const SNIPPET_MARKER = "## Work items (Docket)";
const AGENT_FILES = ["CLAUDE.md", "AGENTS.md"];

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

/** Each step returns "created" | "updated" | "unchanged" and writes only when `write` is true. */
function ensureItemsDir(ctx, write) {
  if (fs.existsSync(ctx.itemsDir)) return "unchanged";
  if (write) fs.mkdirSync(ctx.itemsDir, { recursive: true });
  return "created";
}

function ensureConfig(ctx, write) {
  if (fs.existsSync(ctx.configPath)) return "unchanged";
  if (write) writeConfig(ctx, DEFAULT_CONFIG);
  return "created";
}

function ensureIgnore(ctx, write) {
  const file = path.join(ctx.root, ".gitignore");
  const text = read(file);
  if ((text ?? "").split(/\r?\n/).some((l) => /^\/?\.docket\/?$/.test(l.trim())))
    return "unchanged";
  if (write) {
    const base = text ?? "";
    const eol = base.includes("\r\n") ? "\r\n" : "\n";
    const sep = base === "" || base.endsWith("\n") ? "" : eol;
    atomicWrite(file, `${base}${sep}.docket/${eol}`);
  }
  return text === null ? "created" : "updated";
}

/** Append the snippet (in the file's own line endings) to each agent file; create CLAUDE.md if none. */
function ensureAgentSnippet(ctx, write) {
  const snippet = fs.readFileSync(SNIPPET_FILE, "utf8").replace(/\r\n/g, "\n");
  const present = AGENT_FILES.filter((n) => fs.existsSync(path.join(ctx.root, n)));
  if (!present.length) {
    if (write) {
      const title = path.basename(ctx.root);
      atomicWrite(path.join(ctx.root, "CLAUDE.md"), `# ${title}\n\n${snippet}`);
    }
    return [{ path: "CLAUDE.md", state: "created" }];
  }
  return present.map((name) => {
    const file = path.join(ctx.root, name);
    const text = read(file);
    if (text.includes(SNIPPET_MARKER)) return { path: name, state: "unchanged" };
    if (write) {
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      const lf = text.replace(/\r\n/g, "\n");
      const joined = lf === "" ? snippet : `${lf.replace(/\n+$/, "")}\n\n${snippet}`;
      atomicWrite(file, joined.replace(/\n/g, eol));
    }
    return { path: name, state: "updated" };
  });
}

/**
 * Initialise the repo containing `start`. Returns {root, dryRun, initialised, created: string[] (paths
 * that are new or changed), files: [{path, state}], agentFiles, gate}. Throws DOCKET_NOT_A_REPO outside
 * a git worktree (resolveRepo).
 */
export function initRepo(start, { gate = false, dryRun = false, gateOptions = {} } = {}) {
  const ctx = resolveRepo(start);
  const write = !dryRun;
  const files = [
    { path: "docs/items/", state: ensureItemsDir(ctx, write) },
    { path: "docket.json", state: ensureConfig(ctx, write) },
    { path: ".gitignore", state: ensureIgnore(ctx, write) },
    ...ensureAgentSnippet(ctx, write),
  ];
  const changed = files.filter((f) => f.state !== "unchanged");
  const agentFiles = changed.map((f) => f.path).filter((n) => AGENT_FILES.includes(n));
  const gateResult = gate ? installRepo(ctx.root, { ...gateOptions, dryRun }) : null;
  return {
    root: ctx.root,
    dryRun,
    initialised: changed.length > 0,
    created: changed.map((f) => f.path),
    files,
    agentFiles,
    gate: gateResult,
  };
}
