// Per-command help text. Allowed enum values come from the schema so help never drifts from validation.
import { ENUMS } from "../core/format/schema.mjs";

const list = (values) => values.join(" | ");
const VALUES = `
Values:
  type      ${list(ENUMS.type)}
  status    ${list(ENUMS.status)}
  priority  ${list(ENUMS.priority)}`;
const COMMON = "\nEvery command also takes --repo <path>, --json and --help.";

const HELP = {
  init: `Usage: docket init [--gate] [--no-agent-snippet] [--dry-run]

Make this repo a Docket repo (idempotent). Creates docs/items/ and docket.json, ignores .docket/ and
adds the agent snippet to CLAUDE.md / AGENTS.md. Reports each file as created, updated or unchanged.
  --gate      also install the pre-push gate (see docket gate install)
  --no-agent-snippet  leave CLAUDE.md / AGENTS.md alone (never creates CLAUDE.md)
  --dry-run   report what would change; write nothing`,
  check: `Usage: docket check [--ref <rev>]

Validate every item. Errors exit 1; warnings print. --ref checks a Git revision instead of the worktree.`,
  add: `Usage: docket add --type T --priority P --title "..." [options]
       docket add --batch <file|->

Create an item; the ID and rank are assigned. Prints "<id>  <title>" (--json: the full created item).
  --body TEXT | --body-file F   body text; --body-file - reads stdin
  --area A  --status S  --parent ID
  --fixes ID  --blocked-by ID  --relates ID   (repeatable)
  --batch F   create many from a JSON array of {type, priority, status?, title, body?, area?, created?, since?}
              (F or - for stdin). Everything is validated before anything is written; prints
              "<id>  <title>" lines (--json: {count, items}, the full created items). Not combinable with the single-item options.
${VALUES}`,
  set: `Usage: docket set <id> [--status S] [--priority P] [--type T] [--area A]
                   [--title T] [--before ID | --after ID | --top | --bottom] [--expect REV]

Change fields or reorder. A real status change resets since to today.
--title rewrites only the H1 (one non-empty line); body and frontmatter are untouched.
${VALUES}`,
  link: `Usage: docket link <id> [--parent ID | --clear-parent] [--fixes ID]... [--blocked-by ID]...
                    [--relates ID]... [--remove] [--expect REV]

Add (or with --remove, remove) relations.`,
  list: `Usage: docket list [--status S]... [--type T]... [--priority P]... [--area A] [--parent ID]
                   [--blocked] [--all] [--limit N] [--rank] [--count-by FIELD]

List items (done and dropped hidden unless --all or --status). --limit defaults to 50, max 500.
  --rank            show the rank column in text output
  --count-by FIELD  print counts instead of items; FIELD is status | type | priority (--json: an object)
${VALUES}`,
  show: "Usage: docket show <id>\n\nPrint one item with its claim and relations.",
  index: "Usage: docket index [--rebuild]\n\nRefresh the per-worktree cache.",
  claim:
    "Usage: docket claim <id> [--takeover] [--agent NAME]\n\nAdvisory claim for this worktree.",
  release: "Usage: docket release <id> [--force]\n\nRelease a claim.",
  gate: `Usage: docket gate promote <tarball>
       docket gate install [--dry-run]
       docket gate status

Last-good pre-push gate. install writes the managed pre-push hook and local git config
(docket.gateLauncher, docket.gateNode) and reports each as created, updated or unchanged;
--dry-run reports without writing.`,
  repo: `Usage: docket repo add <path> [--alias NAME] [--preferred] [--doc NAME=relative/path.md]...
       docket repo list
       docket repo remove <alias> [--checkout <path>]
       docket repo scan <dir> [--dry-run]

Per-machine registry of Docket repos: DOCKET_HOME or %LOCALAPPDATA%/Docket, registry.json (metadata only).
add registers a checkout that has docket.json. Linked worktrees join their clone's group; independent
clones stay separate. Re-adding updates --alias, --preferred (prefer this checkout) and --doc.
  --doc NAME=PATH   where a living doc lives (STRUCTURE, ARCHITECTURE, DECISIONS, FEATURES, ROADMAP,
                    BACKLOG, GOTCHAS), relative to the checkout; NAME= removes the override
list shows every checkout and marks unavailable ones with the reason (never deleted automatically).
remove drops the registration only (files untouched); --checkout drops one checkout of the group.
scan walks <dir> once for Git checkout roots holding docket.json (nested repos and worktrees included,
links not followed) and adds new ones; existing aliases and overrides are kept. --dry-run writes nothing.`,
};

// One line per command, in display order; the top-level overview is built from this.
const SUMMARY = {
  init: "make this repo a Docket repo (idempotent)",
  check: "validate every item (errors fail, warnings print)",
  add: "create an item (ID and rank are assigned), or many with --batch",
  set: "change fields or reorder an item",
  link: "add or remove relations",
  list: "list items (filters, --count-by)",
  show: "print one item with its claim and relations",
  index: "refresh the per-worktree cache",
  claim: "advisory claim for this worktree",
  release: "release a claim",
  gate: "last-good pre-push gate (promote | install | status)",
  repo: "per-machine repo registry (add | list | remove | scan)",
};

/** Top-level overview: one line per command; `docket <command> --help` has the options. */
export function overview() {
  const width = Math.max(...Object.keys(SUMMARY).map((c) => c.length));
  return [
    "docket (dk) - Markdown work items per repo",
    "",
    "Usage: docket <command> [options]      every command takes --repo <path> and --json",
    "",
    ...Object.entries(SUMMARY).map(([c, s]) => `  ${c.padEnd(width)}  ${s}`),
    "",
    "  docket <command> --help   options and allowed values for one command",
    "",
    "  --version, -v   print the version",
  ].join("\n");
}

/** Help text for one command, or null when unknown. */
export function commandHelp(command) {
  const text = HELP[command];
  return text ? `${text}\n${COMMON}` : null;
}
