// The managed agent snippet in CLAUDE.md / AGENTS.md: detection, in-place upgrade and persistence.
// The snippet lives between versioned begin/end comments. A recognised older managed block, or the
// exact unmarked legacy snippet (0.3.0-0.5.x), is replaced in place; surrounding bytes and the file's
// line endings are kept. Duplicate or incomplete markers and customised legacy sections are never
// touched: they are reported for manual review, and no second block is ever appended.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite } from "../storage/atomic-write.mjs";

export const SNIPPET_VERSION = 2;
export const AGENT_FILES = Object.freeze(["CLAUDE.md", "AGENTS.md"]);
const SNIPPET_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "agent-snippet.md");
const HEADING = "## Work items (Docket)";
const BEGIN_RE = /^<!-- docket:agent-snippet begin v(\d+) -->\r?$/gm;
const END_RE = /^<!-- docket:agent-snippet end -->\r?$/gm;

/** The unmarked snippet shipped by 0.3.0 to 0.5.x (LF form). Only an exact copy is migrated. */
export const LEGACY_SNIPPET = `## Work items (Docket)

Track work in \`docs/items/\` through \`dk\`. Use filtered \`dk list --json\` and \`dk show\`; use \`add\`, \`set\`,
and \`link\` for changes. Never invent IDs or ranks. Claim work in the current worktree, release it when
finished, and run \`dk check\` before pushing. Drop items instead of deleting them. Living docs remain
ordinary Markdown.
`;

/** The current managed block (LF), begin and end markers included, ending with LF. */
export function managedBlock() {
  const body = fs.readFileSync(SNIPPET_FILE, "utf8").replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
  return (
    `<!-- docket:agent-snippet begin v${SNIPPET_VERSION} -->\n${body}` +
    `<!-- docket:agent-snippet end -->\n`
  );
}

/**
 * The exact legacy block in `text`, in either host line ending, starting a line; its final line ending
 * may be missing only at end of file. Returns {index, length, eol} or null.
 */
function findLegacy(text) {
  for (const eol of ["\r\n", "\n"]) {
    const full = LEGACY_SNIPPET.replace(/\n/g, eol);
    const bare = full.slice(0, -eol.length);
    let at = text.indexOf(bare);
    while (at >= 0) {
      const startsLine = at === 0 || text[at - 1] === "\n";
      const after = text.slice(at + bare.length, at + full.length);
      if (startsLine && after === eol) return { index: at, length: full.length, eol };
      if (startsLine && at + bare.length === text.length)
        return { index: at, length: bare.length, eol };
      at = text.indexOf(bare, at + 1);
    }
  }
  return null;
}

const eolOf = (text) => (text.includes("\r\n") ? "\r\n" : "\n");
const inEol = (block, eol) => block.replace(/\n/g, eol);
const lineEnd = (text, at) => {
  const lf = text.indexOf("\n", at);
  return lf < 0 ? text.length : lf + 1;
};
const review = (reason) => ({ state: "manual-review", reason });

/**
 * Plan the snippet for one file's text (null = absent). Returns {state, text?, reason?}: state is
 * created | updated | unchanged | manual-review; text is the new content when it changes.
 */
export function planSnippet(text, { title }) {
  const block = managedBlock();
  if (text === null) return { state: "created", text: `# ${title}\n\n${block}` };
  const begins = [...text.matchAll(BEGIN_RE)];
  const ends = [...text.matchAll(END_RE)];
  if (begins.length || ends.length) {
    if (begins.length !== 1 || ends.length !== 1) {
      return review("duplicate or incomplete docket:agent-snippet markers");
    }
    const [begin, end] = [begins[0], ends[0]];
    if (end.index < begin.index) return review("docket:agent-snippet end marker before begin");
    const stop = lineEnd(text, end.index);
    const replacement = inEol(block, eolOf(text.slice(begin.index, stop)));
    const current = text.slice(begin.index, stop);
    const sameBlock = current === replacement || current === replacement.replace(/\r?\n$/, "");
    if (sameBlock) return { state: "unchanged" };
    return { state: "updated", text: text.slice(0, begin.index) + replacement + text.slice(stop) };
  }
  const headings = text.split(/\r?\n/).filter((l) => l === HEADING).length;
  if (headings > 0) {
    const legacy = findLegacy(text);
    if (headings > 1 || !legacy) {
      return review(
        headings > 1
          ? `"${HEADING}" appears more than once`
          : `"${HEADING}" is customised (not the exact legacy snippet)`,
      );
    }
    const out =
      text.slice(0, legacy.index) +
      inEol(block, legacy.eol) +
      text.slice(legacy.index + legacy.length);
    return { state: "updated", text: out };
  }
  const eol = eolOf(text);
  const sep = text === "" ? "" : text.endsWith("\n") ? eol : eol + eol;
  return { state: "updated", text: text + sep + inEol(block, eol) };
}

/**
 * Ensure the managed snippet in both agent files under `root`, creating missing ones. Returns
 * [{path, state, reason?}]; writes nothing when `dryRun`.
 */
export function ensureAgentSnippets(root, { dryRun = false } = {}) {
  return AGENT_FILES.map((name) => {
    const file = path.join(root, name);
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const plan = planSnippet(text, { title: path.basename(root) });
    if (plan.text !== undefined && !dryRun) atomicWrite(file, plan.text);
    return { path: name, state: plan.state, ...(plan.reason ? { reason: plan.reason } : {}) };
  });
}
