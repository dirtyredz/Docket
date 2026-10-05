# ARCHITECTURE

How Docket works. Code map is in `../STRUCTURE.md`; reasons are in `DECISIONS.md`. Status: M0 to M4d
implemented (CLI, core, storage, index, claims, gate, init, registry, viewer; 0.5.0). Authority: `PLAN.md`, `PLAN-VIEWER.md` and `research/ITEM-SPEC.md`.

## Truth and caches

- **Item files are the only truth.** One Markdown file per item at `docs/items/<id>.md` in the owning
  repo, strict 12-key frontmatter, H1 title, free body. Git is the history; items never leave their repo.
- **Everything else is rebuildable.** `<repo>/.docket/index.json` is a per-worktree cache built from
  source hashes; missing, stale or corrupt means rebuild. `docket check` always reads the files, never
  the index.
- **`<repo>/docket.json`** (committed) holds the store version and explicit migration state. No
  configurable schema vocabulary.

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

## Viewer

`docket serve` binds `127.0.0.1` only, prints the URL, and runs in the foreground.

- **Targeting.** Overview and title search read one preferred checkout per group (counted once). Other
  checkouts load on demand. Edits need an explicitly selected checkout, addressed by registry ids only (never
  client paths), re-verified against Git on every mutation. Other worktrees' claims and branch work are
  advisory hints, never written.
- **Catalog.** Transient summaries built from each checkout's `.docket/index.json`, loaded progressively
  (preferred checkouts first, yielding between repos); coverage and unavailable repos are reported. Nothing
  persisted.
- **Request security.** Exact loopback Host and port; a present Origin must be the server's own; Sec-Fetch-Site
  cross-site refused. Mutations also need a per-process CSRF token, a JSON body and the Origin. CSP, nosniff,
  `X-Frame-Options: DENY`, no CORS, known static assets only, bodies capped at 64 KB. Item storage is checked
  for links and containment before core touches it.
- **Revision flow.** Detail returns the item's revision plus the revisions of relation holders. Save and relation
  actions send them back; core asserts them inside the lock (ADR-24). A 409 keeps the browser draft.
- **Documents** are read-only: per-repo override, then repo root, then `docs/`; Markdown is sanitized (ADR-23).

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
