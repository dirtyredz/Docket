# Docket

Docket is a Windows 11 command-line tool and local viewer for tracking work as Markdown
files, one file per item, stored in the repository the work belongs to. Items branch and merge with the
code, and every index or cache can be rebuilt from the files.

**Status (0.5.0): CLI, gate, `docket init`, batch add, move-in playbook, repo registry and local viewer shipped.** The item format is `docs/research/ITEM-SPEC.md`; the plan is
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
docket repo add <path> [--alias A] [--preferred] [--doc NAME=rel.md]   register a checkout (worktrees group by Git common dir)
docket repo list
docket repo remove <alias> [--checkout <path>]
docket repo scan <dir> [--dry-run]               one-shot, additive discovery of Docket checkouts
docket serve [--port N]                          local viewer on 127.0.0.1
docket gate promote <tarball>  /  docket gate install [--dry-run]  /  docket gate status
```

`docket init` creates `docs/items/` and `docket.json`, ignores `.docket/` and adds the agent snippet to
CLAUDE.md / AGENTS.md (`--no-agent-snippet` skips that, for repos whose CLAUDE.md is global instructions). To move an existing backlog in, have an agent follow the `docs/MOVE-IN.md` playbook (shipped inside the installed package, under the `docket` package root).

## Viewer

Register repos (`docket repo scan C:/path/to/projects`, or `docket repo add <path>`), then run `docket serve`. It
prints `http://127.0.0.1:<port>/`; open it in a browser. It listens on loopback only, never auto-starts, and
Ctrl+C stops it. `--json` prints one startup envelope after binding. The registry is
`%LOCALAPPDATA%/Docket/registry.json` (`DOCKET_HOME` overrides). The viewer edits title, status, priority and
relations; documents and item bodies are read-only. Keys: `/` search, `r` refresh, `Esc` closes the detail.

## Install

Requires Node 22 or newer. Use an ABSOLUTE tarball path with `npm install --global`: a relative one is read as a GitHub spec.

```
npm ci
npm test                                        # includes test:registry, test:viewer, test:e2e
npx playwright install chromium                 # for test:e2e; optional when Edge or Chrome is installed
npm run build                                   # dist/docket-<version>.tgz
npm install --global C:/path/to/repo/dist/docket-<version>.tgz
docket gate promote dist/docket-<version>.tgz   # tested copy under %LOCALAPPDATA%Docketgate
docket gate install --repo .                    # opt this clone's pre-push hook in
```
