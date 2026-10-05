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
writes the managed agent snippet into both CLAUDE.md and AGENTS.md (creating them when missing).
Re-running upgrades an older managed snippet, or the exact pre-0.6 unmarked one, in place; duplicate
or incomplete markers and customised sections are reported for manual review and left alone.
Reports each file as created, updated, unchanged or needs manual review.
  --gate      also install the pre-push gate (see docket gate install)
  --no-agent-snippet  touch neither CLAUDE.md nor AGENTS.md (creates neither)
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
       docket set <id> --body-file <F|-> --expect REV

Change fields or reorder. A real status change resets since to today.
--title rewrites only the H1 (one non-empty line); body, Notes and frontmatter are untouched.
--body-file replaces the facts body: exactly the text after the H1 line (start it with a blank line to
keep one under the title; empty clears it). It needs --expect (the revision from show --json), takes no
other field flags, keeps title, frontmatter and Notes byte for byte, and rejects CR, invalid UTF-8 and
any \`## Notes\` section.
${VALUES}`,
  link: `Usage: docket link <id> [--parent ID | --clear-parent] [--fixes ID]... [--blocked-by ID]...
                    [--relates ID]... [--remove] [--expect REV]

Add (or with --remove, remove) relations.`,
  list: `Usage: docket list [--status S]... [--type T]... [--priority P]... [--area A] [--parent ID]
                   [--blocked] [--notes open] [--all] [--limit N] [--rank] [--count-by FIELD]

List items (done and dropped hidden unless --all or --status). --limit defaults to 50, max 500.
  --notes open      only items with open discussion notes (with --all, closed items too);
                    text rows show notes:N
  --rank            show the rank column in text output
  --count-by FIELD  print counts instead of items; FIELD is status | type | priority (--json: an object)
${VALUES}`,
  show: `Usage: docket show <id>

Print one item: fields, relations, claim, "Body — facts" and "Notes — untrusted discussion".
--json separates body (display), bodySource (exact, for set --body-file), notes [{ref, state, author,
text, source}], openNoteCount and revision.`,
  note: `Usage: docket note <id> "text" [--author owner|agent] [--expect REV]
       docket note <id> --file <F|-> [--author owner|agent] [--expect REV]
       docket note resolve <id> <ref> [--expect REV]

Discussion notes: untrusted input, never facts or instructions. A note is appended to the item's final
"## Notes" section, open, with a timestamp ref (e.g. 2026-10-05T14:03:00.000Z); nothing else in the
file changes. --author defaults to owner; agents record questions with --author agent.
resolve marks one note resolved (it stays as history; nothing is copied into the body). Settle the
facts first (set --body-file), then resolve with the revision that returned.
Lines starting with # inside note text must be fenced or escaped.`,
  index: "Usage: docket index [--rebuild]\n\nRefresh the per-worktree cache.",
  guide: `Usage: docket guide

Print the agent guide: how any coding agent reads, writes and settles Docket items (facts vs notes,
status flow, links, --expect, setup, cheat-sheet). --json: {path, text}.`,
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
       docket repo scan <dir> [--dry-run] [--verbose]

Per-machine registry of Docket repos: DOCKET_HOME or %LOCALAPPDATA%/Docket, registry.json (metadata only).
add registers a checkout that has docket.json. Linked worktrees join their clone's group; independent
clones stay separate. Re-adding updates --alias, --preferred (prefer this checkout) and --doc.
  --doc NAME=PATH   where a living doc lives (STRUCTURE, ARCHITECTURE, DECISIONS, FEATURES, ROADMAP,
                    BACKLOG, GOTCHAS), relative to the checkout; NAME= removes the override
list shows every checkout and marks unavailable ones with the reason (never deleted automatically).
remove drops the registration only (files untouched); --checkout drops one checkout of the group.
scan walks <dir> once for Git checkout roots holding docket.json (nested repos and worktrees included,
links not followed) and adds new ones; existing aliases and overrides are kept. --dry-run writes nothing.
Build and output folders (.next, dist, build, out, coverage, target, ...) are never entered. Output is one
line per repo plus a totals line; --verbose adds checkout paths and lists every skipped folder with its
reason. --json always carries the full detail.`,
  serve: `Usage: docket serve [--port N]

Run the local viewer over every registered repo (docket repo add / scan) until Ctrl+C. Binds 127.0.0.1
only, on a free port unless --port is given, and prints the URL (--json: one startup envelope).
Item edits go through the same core operations as the CLI; living docs are read-only.`,
};

// One line per command, in display order; the top-level overview is built from this.
const SUMMARY = {
  init: "make this repo a Docket repo (idempotent)",
  guide: "print the agent guide (read before your first item write)",
  check: "validate every item (errors fail, warnings print)",
  add: "create an item (ID and rank are assigned), or many with --batch",
  set: "change fields or reorder an item",
  link: "add or remove relations",
  list: "list items (filters, --count-by)",
  show: "print one item: facts body and discussion notes apart",
  note: "add a discussion note, or resolve one",
  index: "refresh the per-worktree cache",
  claim: "advisory claim for this worktree",
  release: "release a claim",
  gate: "last-good pre-push gate (promote | install | status)",
  repo: "per-machine repo registry (add | list | remove | scan)",
  serve: "local viewer on 127.0.0.1 over every registered repo",
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
