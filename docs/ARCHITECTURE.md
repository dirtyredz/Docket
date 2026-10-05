# ARCHITECTURE

How Docket works. Code map is in `../STRUCTURE.md`; reasons are in `DECISIONS.md`. Status: M0 to M2b
implemented (CLI, core, storage, index, claims, gate, init); M3+ is design only. Authority: `PLAN.md` and `research/ITEM-SPEC.md`.

## Truth and caches

- **Item files are the only truth.** One Markdown file per item at `docs/items/<id>.md` in the owning
  repo, strict 12-key frontmatter, H1 title, free body. Git is the history; items never leave their repo.
- **Everything else is rebuildable.** `<repo>/.docket/index.json` is a per-worktree cache built from
  source hashes; missing, stale or corrupt means rebuild. `docket check` always reads the files, never
  the index.
- **`<repo>/docket.json`** (committed) holds the store version and explicit migration state. No
  configurable schema vocabulary.

## State locations

| Location                                                       | Contents                                               | Committed |
| -------------------------------------------------------------- | ------------------------------------------------------ | --------- |
| `<repo>/docs/items/<id>.md`                                    | the items                                              | yes       |
| `<repo>/docket.json`                                           | store version                                          | yes       |
| `<repo>/.docket/index.json`                                    | disposable index for this checkout                     | no        |
| `<git-common-dir>/docket-claims.json`                          | advisory claims shared by linked worktrees             | no        |
| `<git-common-dir>/docket-conflicts.jsonl`                      | local conflict observations                            | no        |
| `%LOCALAPPDATA%/Docket/registry.json`                          | repo aliases, canonical paths, doc overrides; no items | no        |
| `%LOCALAPPDATA%/Docket/gate/versions/<v>/`, `gate/active.json` | tested checker installs, selected last-good            | no        |

## Write and lock model

Every mutation: take the per-worktree lock, load the item, apply the change in core, validate the
candidate graph, serialize canonically, reparse the output, compare the expected revision, then
temp-write, fsync, rename. Body bytes are untouched. A stale expected revision returns a structured
conflict (CLI) or HTTP 409 (viewer). `add` never overwrites an existing destination and retries ID
collisions. Only cooperating Docket writers lock; an external editor can still race between revision
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

Per-machine list of repos (alias, canonical path, linked-worktree identity, relative document
overrides). Unavailable repos are reported, never deleted. It holds no items, so the viewer aggregates
transiently while persisted indexes stay per checkout.

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

## Viewer checkout targeting

`docket serve` binds loopback and calls the same core operations as the CLI. Reads return revisions.
Editing requires an explicitly selected checkout; observations of other worktrees (claims, branch-local
work) are labeled advisory hints and are never written into the main checkout. Paths are restricted to
registered, contained locations; traversal, foreign origins and unsafe HTML are rejected. Living docs
are rendered read-only; there is no document-write endpoint.

## Init and move-in

`docket init` (`integration/init.mjs`, adapter `cli/commands/init.mjs`) makes the current worktree a Docket
repo: it creates `docs/items/` and `docket.json` (store version only), ignores `.docket/`, appends the agent
snippet to `CLAUDE.md` and `AGENTS.md` (creating `CLAUDE.md` when neither exists), and with `--gate` runs the
gate install. Every step is skipped when already done; a run that changes nothing reports "already
initialised". It refuses outside a git worktree. There is no importer: an existing backlog moves in once,
through an agent following `MOVE-IN.md` with the ordinary `dk add` / `dk set` commands (ADR-19).

## External interfaces

CLI with `--repo` and bounded `--json` (no MCP). Git pre-push hook via the managed template's opt-in
Docket callback. Repo-specific adapters (legacy-writer retirement, documentation checkers) live in the
adopting repo, not here.
