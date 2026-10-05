// `docket init`: make the current repo a Docket repo. Idempotent: every step is skipped when already
// done, and a run that changes nothing reports `initialised: false`. The gate is opt-in (`gate: true`)
// and reuses the existing install logic.
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

function ensureItemsDir(ctx) {
  if (fs.existsSync(ctx.itemsDir)) return false;
  fs.mkdirSync(ctx.itemsDir, { recursive: true });
  return true;
}

function ensureConfig(ctx) {
  if (fs.existsSync(ctx.configPath)) return false;
  writeConfig(ctx, DEFAULT_CONFIG);
  return true;
}

function ensureIgnore(ctx) {
  const file = path.join(ctx.root, ".gitignore");
  const text = read(file) ?? "";
  if (text.split(/\r?\n/).some((l) => /^\/?\.docket\/?$/.test(l.trim()))) return false;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const sep = text === "" || text.endsWith("\n") ? "" : eol;
  atomicWrite(file, `${text}${sep}.docket/${eol}`);
  return true;
}

/** Append the snippet (in the file's own line endings) to each agent file; create CLAUDE.md if none. */
function ensureAgentSnippet(ctx) {
  const snippet = fs.readFileSync(SNIPPET_FILE, "utf8").replace(/\r\n/g, "\n");
  const present = AGENT_FILES.filter((n) => fs.existsSync(path.join(ctx.root, n)));
  const touched = [];
  if (!present.length) {
    const title = path.basename(ctx.root);
    atomicWrite(path.join(ctx.root, "CLAUDE.md"), `# ${title}\n\n${snippet}`);
    return ["CLAUDE.md"];
  }
  for (const name of present) {
    const file = path.join(ctx.root, name);
    const text = read(file);
    if (text.includes(SNIPPET_MARKER)) continue;
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lf = text.replace(/\r\n/g, "\n");
    const joined = lf === "" ? snippet : `${lf.replace(/\n+$/, "")}\n\n${snippet}`;
    atomicWrite(file, joined.replace(/\n/g, eol));
    touched.push(name);
  }
  return touched;
}

/**
 * Initialise the repo containing `start`. Returns {root, initialised, created: string[], agentFiles,
 * gate}. Throws DOCKET_NOT_A_REPO outside a git worktree (resolveRepo).
 */
export function initRepo(start, { gate = false, gateOptions = {} } = {}) {
  const ctx = resolveRepo(start);
  const created = [];
  if (ensureItemsDir(ctx)) created.push("docs/items/");
  if (ensureConfig(ctx)) created.push("docket.json");
  if (ensureIgnore(ctx)) created.push(".gitignore");
  const agentFiles = ensureAgentSnippet(ctx);
  created.push(...agentFiles);
  const gateResult = gate ? installRepo(ctx.root, gateOptions) : null;
  return { root: ctx.root, initialised: created.length > 0, created, agentFiles, gate: gateResult };
}
