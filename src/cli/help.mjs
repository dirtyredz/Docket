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
  init: `Usage: docket init [--gate] [--dry-run]

Make this repo a Docket repo (idempotent). Creates docs/items/ and docket.json, ignores .docket/ and
adds the agent snippet to CLAUDE.md / AGENTS.md. Reports each file as created, updated or unchanged.
  --gate      also install the pre-push gate (see docket gate install)
  --dry-run   report what would change; write nothing`,
  check: `Usage: docket check [--ref <rev>]

Validate every item. Errors exit 1; warnings print. --ref checks a Git revision instead of the worktree.`,
  add: `Usage: docket add --type T --priority P --title "..." [options]
       docket add --batch <file|->

Create an item; the ID and rank are assigned. Prints "<id>  <title>" (--json: the full created item).
  --body TEXT | --body-file F   body text; --body-file - reads stdin
  --area A  --status S  --parent ID
  --fixes ID  --blocked-by ID  --relates ID   (repeatable)
  --batch F   create many from a JSON array of {type, priority, status?, title, body?, area?}
              (F or - for stdin). Everything is validated before anything is written; prints
              "<id>  <title>" lines (--json: {count, items}, the full created items). Not combinable with the single-item options.
${VALUES}`,
  set: `Usage: docket set <id> [--status S] [--priority P] [--type T] [--area A]
                   [--before ID | --after ID | --top | --bottom] [--expect REV]

Change fields or reorder. A real status change resets since to today.
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
