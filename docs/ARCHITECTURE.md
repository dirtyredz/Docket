# ARCHITECTURE

How Docket works. Code map is in `../STRUCTURE.md`; reasons are in `DECISIONS.md`. Status: M0 to M3b
and M6 implemented (CLI, core, storage, index, claims, gate, init, registry, headless library; 0.8.0). Authority: `plans/PLAN.md` and `research/ITEM-SPEC.md`. The viewer was removed in 0.7.0 (ADR-29); the headless library contract is ADR-30.

## Truth and caches

- **Item files are the only truth.** One Markdown file per item at `docs/items/<id>.md` in the owning
  repo, strict 12-key frontmatter, H1 title, facts body, optional final `## Notes`. Git is the history; items never leave their repo.
- **Everything else is rebuildable.** `<repo>/.docket/index.json` is a per-worktree cache (version 2) built from
  source hashes; missing, stale or corrupt means rebuild. `docket check` always reads the files, never
  the index.
- **`<repo>/docket.json`** (committed) holds the store version and explicit migration state. No
  configurable schema vocabulary.

## Content model

An item file is three byte ranges: frontmatter, the H1 title plus the **body** (authoritative facts), and an
optional final **Notes** section (untrusted discussion; ADR-26). `core/format/content.mjs` finds the
boundaries and owns the Notes grammar; `core/items/content/` holds body replacement and note
append/resolve. They write through the **preserved-prefix** path of the shared transaction: the frontmatter
is kept verbatim and only the bytes of the edited range change, then the result is reparsed and revision
checked (ADR-27). Scalar and relation edits keep the canonical rewrite. Index version 2 caches
`openNoteCount` per item and no body or note text, so discussion filters need no file reads; version 1
caches rebuild on first run.

## State locations

| Location                                                       | Contents                                                    | Committed |
| -------------------------------------------------------------- | ----------------------------------------------------------- | --------- |
| `<repo>/docs/items/<id>.md`                                    | the items                                                   | yes       |
| `<repo>/docket.json`                                           | store version                                               | yes       |
| `<repo>/.docket/index.json`                                    | disposable index for this checkout                          | no        |
| `<git-common-dir>/docket-claims.json`                          | advisory claims shared by linked worktrees                  | no        |
| `<git-common-dir>/docket-conflicts.jsonl`                      | local conflict observations                                 | no        |
| `%LOCALAPPDATA%/Docket/registry.json`                          | repo ids, aliases, checkout groups, doc overrides; no items | no        |
| `%LOCALAPPDATA%/Docket/gate/versions/<v>/`, `gate/active.json` | tested checker installs, selected last-good                 | no        |

## Write and lock model

Every mutation: take the per-worktree lock, load the item, apply the change in core, validate the
candidate graph, serialize canonically, reparse the output, compare the expected revision, then
temp-write, fsync, rename. Body bytes are untouched. A stale expected revision returns a structured
conflict (CLI, exit 3). `add` never overwrites an existing destination and retries ID
collisions. A relation edit may rewrite a second file (a `relates` edge stored on the other item); with a revision
map (`expectRevisions`) the selected item and every other file it rewrites are checked before the first write.
The files are written one by one, each atomically: a failure after the first write is rethrown with `partial` and
`written`. Only cooperating Docket writers lock; an external editor can still race between revision
check and rename (see GOTCHAS).

The lock is `.docket/items.lock` (exclusive create, `{pid, at, token}`). A waiter breaks a lock only
when its owner is dead and the lock is over a second old, or it is over a minute old, and breaks it by
rename-then-verify so a lock re-taken in between survives. "Candidate graph" validation compares the
store's errors before and after the change: only errors the change introduces reject it, so an
unrelated broken file never blocks an edit. Create-only writes hard-link the temp file (atomic
no-overwrite); replacements rename it. Both retry transient Windows `EPERM`/`EBUSY`/`EACCES`.

Failures are `docketError(code, message, details)` from `core/errors.mjs`; its table maps every code
to a CLI exit kind (usage 2, conflict 3, not found 4, otherwise 1), and the CLI output layer keys off it.
Claims and the index live under `src/state/` and are passed into core operations as dependencies.

## Claims

Advisory, per clone: `docket-claims.json` in the git common dir, guarded by its own lock, atomic
read-modify-write. A claim whose worktree path no longer exists expires on read. `release` and
completion remove the matching claim. The durable state is `status: wip` + `since` on the branch;
claim cleanup failure is reported without pretending the item write failed.

## Registry

`%LOCALAPPDATA%/Docket/registry.json` (`DOCKET_HOME` overrides; no fallback into a repo), written under its
own lock, atomically. It holds no items, counts or claims.

- **Identity.** Registry ids are `r-` (repo group) and `c-` (checkout). A group is the canonical Git common
  dir: linked worktrees join it, independent clones stay separate. Paths compare by real path
  (`repository/canonical`), case-insensitively on Windows. Aliases are unique.
- **Preferred checkout.** The first registered, or, from a scan, the main checkout. Changed only by the owner
  (`repo add --preferred`); removing it prefers the first remaining one and says so. Never silent failover.
- **Scan.** `repo scan <dir>` is one-shot and additive: it walks for Git checkout roots holding `docket.json`
  (nested repos and `.claude/worktrees/` included), reports skipped links and junctions without following
  them, keeps existing aliases and overrides, and never initialises, watches or prunes.
- **Document overrides** (`repo add --doc NAME=rel.md`) are stored and validated metadata shown by `repo list`; Docket renders nothing from them.
- **Unavailable** checkouts are listed with a reason, never deleted; `repo remove` is the only exit.

## Last-good gate

Pre-push must not depend on the working tree being healthy. A tested tarball is promoted into
`%LOCALAPPDATA%/Docket/gate/versions/<v>/` only after smoke tests pass; the previous version is kept.
`active.json` names the selected one. A stable launcher runs that install, never a build or
working-tree import. Pushed local tips are validated as `check --ref` does (core `checkStore`, not the CLI), so a clean
working tree cannot hide invalid committed items; deleted refs are skipped. Until the production checker passes its
conformance suite, a quarantined copy of the merge-test prototype gated Docket itself (M0 to M1b);
its promotion path was removed as callerless.

Wiring, per clone and opt-in: `docket gate install` sets `docket.gateLauncher` and `docket.gateNode`
in the repo's local git config and refreshes the managed pre-push hook from the harness template
(foreign hooks and `core.hooksPath` are reported, never changed). The template, only when that key is
set, buffers the ref list once, replays it to LFS then to `node <gate>/launcher.mjs <root>`, and runs
both before the structure pause/opt-out exits. The launcher reads `active.json` and runs
`<version>/<entry> --repo <root> --pre-push` with the refs on stdin; the bootstrap and production
versions shared that contract. A missing launcher fails closed. Version directories are
`<package version>-<tarball sha256 prefix>` so a promotion never overwrites an installed version.
Promotion, smoke test, and repo opt-in are separate modules under `integration/gate/`.

## Init and move-in

`docket init` (`integration/init.mjs`, adapter `cli/commands/init.mjs`) makes the current worktree a Docket
repo: it creates `docs/items/` and `docket.json` (store version only), ignores `.docket/`, writes the managed agent
snippet (`integration/agent-snippet.mjs`, ADR-28) into both `CLAUDE.md` and `AGENTS.md` (creating either; an
older managed or the exact pre-0.6 snippet is upgraded in place, anything customised is reported for manual
review), and with `--gate` runs the
gate install. Every step is skipped when already done; a run that changes nothing reports "already
initialised". It refuses outside a git worktree. There is no importer: an existing backlog moves in once,
through an agent following `MOVE-IN.md` with the ordinary `dk add` / `dk set` commands (ADR-19).

## External interfaces

CLI with `--repo` and bounded `--json` (no MCP). **Command Deck is the UI** (ADR-29): a separate app outside
this repo that talks to Docket through the CLI JSON output contract and, from 0.8.0, the **headless library**
(ADR-30, `docs/LIBRARY.md`): narrow `package.json` subpath exports over core operations, run in Command Deck's
long-lived worker. Scope comes from two openers in `repository/registered-checkout.mjs`: `openCheckoutAt` (an
exact checkout root, never an ancestor) and the registered-checkout opener (Git identity re-verified, cached
for reads by repo id, checkout id, path and common dir; every mutation re-verifies). Both run the containment
guard (no linked or escaping item storage). `state/registry/source.mjs` serves the last good registry with a
visible error and supports a forced refresh. Docket renders nothing; Command Deck owns Markdown and sanitizing. Docket has no HTTP
server; `docket serve` only reports its removal (exit 2). Git pre-push hook via the managed template's opt-in
Docket callback. Repo-specific adapters (legacy-writer retirement, documentation checkers) live in the
adopting repo, not here.
