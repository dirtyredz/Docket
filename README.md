# Docket

Docket is a Windows 11 command-line tool (and, later, a local viewer) for tracking work as Markdown
files, one file per item, stored in the repository the work belongs to. Items branch and merge with the
code, and every index or cache can be rebuilt from the files.

**Status: 0.1.0, milestones M0 to M1c.** The item format is `docs/research/ITEM-SPEC.md`; the plan is
`docs/PLAN.md`.

## Commands

Every command takes `--repo <path>` and `--json` (one JSON document on stdout). `dk` is the same
program as `docket`.

```
docket check [--ref <rev>]                       validate every item; errors exit 1, warnings print
docket add --type T --priority P --title "..."   create an item (ID and rank are assigned)
docket set <id> --status S | --priority P | --before <id> | --after <id> | --top | --bottom
docket link <id> --parent <id> | --fixes <id> | --blocked-by <id> | --relates <id> [--remove]
docket list [--status S] [--type T] [--priority P] [--blocked] [--all] [--limit N]
docket show <id>
docket index [--rebuild]
docket claim <id> [--takeover]   /   docket release <id>
docket gate promote <tarball>  /  docket gate install  /  docket gate status
```

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
