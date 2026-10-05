# Docket

Docket is a Windows 11 command-line tool (and, later, a local viewer) for tracking work as Markdown
files, one file per item, stored in the repository the work belongs to. Items branch and merge with the
code, and every index or cache can be rebuilt from the files.

**Status: CLI, gate, `docket init`, batch add and move-in playbook shipped.** The item format is `docs/research/ITEM-SPEC.md`; the plan is
`docs/PLAN.md`.

## Commands

`docket <command> --help` lists a command's options and allowed values. Every command takes `--repo <path>` and `--json` (one JSON document on stdout). `dk` is the same
program as `docket`.

```
docket init [--gate] [--no-agent-snippet] [--dry-run]   set up this repo (idempotent), reporting each file; --gate also installs the pre-push gate
docket check [--ref <rev>]                       validate every item; errors exit 1, warnings print
docket add --type T --priority P --title "..."   create an item (ID and rank are assigned); --body-file - reads stdin
docket add --batch <file|->                      create many from a JSON array, all-or-nothing
docket set <id> --status S | --priority P | --before <id> | --after <id> | --top | --bottom
docket link <id> --parent <id> | --fixes <id> | --blocked-by <id> | --relates <id> [--remove]
docket list [--status S] [--type T] [--priority P] [--blocked] [--all] [--limit N] [--rank] [--count-by status|type|priority]
docket show <id>
docket index [--rebuild]
docket claim <id> [--takeover]   /   docket release <id>
docket gate promote <tarball>  /  docket gate install [--dry-run]  /  docket gate status
```

`docket init` creates `docs/items/` and `docket.json`, ignores `.docket/` and adds the agent snippet to
CLAUDE.md / AGENTS.md (`--no-agent-snippet` skips that, for repos whose CLAUDE.md is global instructions). To move an existing backlog in, have an agent follow the `docs/MOVE-IN.md` playbook (shipped inside the installed package, under the `docket` package root).

## Install

Requires Node 22 or newer.

```
npm ci
npm test
npm run build                                   # dist/docket-<version>.tgz
npm install --global dist/docket-<version>.tgz
docket gate promote dist/docket-<version>.tgz   # tested copy under %LOCALAPPDATA%Docketgate
docket gate install --repo .                    # opt this clone's pre-push hook in
```
