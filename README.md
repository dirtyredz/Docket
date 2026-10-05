# Docket

Docket is a Windows 11 command-line tool (and, later, a local viewer) for tracking work as Markdown
files, one file per item, stored in the repository the work belongs to. Items branch and merge with the
code, and every index or cache can be rebuilt from the files.

**Status: 0.2.0 installed (M0 to M2b: CLI, gate, EvilEye import and cutover).** The item format is `docs/research/ITEM-SPEC.md`; the plan is
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
docket import evileye --dry-run [--out DIR] [--run NAME] [--overrides FILE]   stage + byte-verify
docket import verify --manifest PATH             re-verify a staged run (drift, bytes, check)
docket import apply --manifest PATH              install a ready run (resumable; marker published last)
```

`docket import` stages under `<repo>/.docket/import/<run>/`, which must be git-ignored (add `.docket/`
to `.git/info/exclude`) or redirected with `--out`. `import apply` refuses a run that is not ready, sources
that changed since the dry run, edited staging and conflicting target files, before writing anything; it
installs items create-only, journals each step in the run directory (`apply-journal.jsonl`), validates the
whole store, writes `docs/records/migrations/docket.json`, then the `docket.json` migration marker. Rerun the
same command after an interruption; once complete it is a no-op.

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
