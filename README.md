# Docket

Docket is a Windows 11 command-line tool and local viewer for tracking work as Markdown files, one
file per item, stored in the repository the work belongs to. Items branch and merge with the code, and
every index or cache can be rebuilt from the files.

**Status: pre-code.** Design and research are in `docs/`; start with `docs/PLAN.md`,
`docs/ARCHITECTURE.md` and `docs/research/ITEM-SPEC.md`.

## Planned commands

```
docket check  --repo .            validate every item (also: dk check)
docket add / set / link           create and edit items (IDs and ranks are assigned for you)
docket list / show  --json        query items
docket claim / release            mark work in progress in this worktree
docket serve                      local viewer/editor on loopback
```

Requires Node 24 or newer. Until the CLI exists:

```
npm install
npm run lint
npm run format:check
```
