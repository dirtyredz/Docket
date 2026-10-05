# ARCHITECTURE

How Docket works. Code map is in `../STRUCTURE.md`; reasons are in `DECISIONS.md`. Status: M0 to M2b
implemented (CLI, core, storage, index, claims, gate, EvilEye import dry run and apply); M3+ is design only. Authority: `PLAN.md` and `research/ITEM-SPEC.md`.

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
| `<repo>/docket.json`                                           | store version, migration marker                        | yes       |
| `<repo>/.docket/index.json`                                    | disposable index for this checkout                     | no        |
| `<repo>/.docket/import/<run>/`                                 | dry-run staging, source hashes, recovery journal       | no        |
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
working-tree import. Pushed local tips are validated with `check --ref`, so a clean working tree cannot
hide invalid committed items; deleted refs are skipped. Until the production checker passes its
conformance suite, a quarantined copy of the merge-test prototype gates Docket itself (M0 to M1b).

Wiring, per clone and opt-in: `docket gate install` sets `docket.gateLauncher` and `docket.gateNode`
in the repo's local git config and refreshes the managed pre-push hook from the harness template
(foreign hooks and `core.hooksPath` are reported, never changed). The template, only when that key is
set, buffers the ref list once, replays it to LFS then to `node <gate>/launcher.mjs <root>`, and runs
both before the structure pause/opt-out exits. The launcher reads `active.json` and runs
`<version>/<entry> --repo <root> --pre-push` with the refs on stdin; the bootstrap and production
versions share that contract. A missing launcher fails closed. Version directories are
`<package version>-<tarball sha256 prefix>` (bootstrap: `bootstrap-<hash>`), so a promotion never
overwrites an installed version.

## Viewer checkout targeting

`docket serve` binds loopback and calls the same core operations as the CLI. Reads return revisions.
Editing requires an explicitly selected checkout; observations of other worktrees (claims, branch-local
work) are labeled advisory hints and are never written into the main checkout. Paths are restricted to
registered, contained locations; traversal, foreign origins and unsafe HTML are rejected. Living docs
are rendered read-only; there is no document-write endpoint.

## Legacy import

`docket import evileye --dry-run` reads the register (`docs/BACKLOG.md`) and shards
(`docs/work/backlog/{open,done}/*.md`), freezes their SHA-256 and HEAD blob ids, and splits each file
into contiguous spans that cover every character: entry, register row (metadata of an item), wrapper
(titles, section and group headings, table header), retained prose (with a reason) and blank. Each entry
becomes one staged item through core allocation, rank and serializer. Its body is the entry's own text
run through recorded, reversible steps (CRLF to LF, list marker and indent off, ID comment removed,
relative links rebased to `docs/items/`, register flags appended as a note). Verification works from
disk only: sources must still match their hashes, every file must rebuild byte for byte (recorded text
for non-item spans, inverted staged bodies for item spans), every span needs a known disposition, every
item comes from exactly one span, and the staged set must pass `check`. Decisions are recorded per item;
ambiguous ones (struck leads without a status word, duplicate IDs) need an `--overrides` file before a
run is `ready`. A run lives in `<repo>/.docket/import/<run>/` (must be git-ignored) as
`manifest.json`, `source-map.json`, `items/` and, when needed, `overrides.template.json`. A later run
reuses the IDs an earlier run allocated (matched by file and first-line hash).

`docket import apply --manifest <run>/manifest.json` installs a ready run. Under the worktree lock it first
checks everything that could make the result wrong (run ready, same repo, no other migration marker, sources
still at their frozen hashes, staged files at their manifest hashes, a fresh full verification, no target
file with different bytes), then creates each item (create-only), validates the whole store, writes the
committed provenance `docs/records/migrations/docket.json` and finally the `docket.json` marker
`{migration: {state: "complete", run, record, ...}}`. Each step appends to `<run>/apply-journal.jsonl`; the
filesystem stays the authority on resume (an item already present with identical bytes counts as
installed), so rerunning after a crash finishes the job. Sources are never written; after completion apply
is a no-op, so the register can be replaced by a navigation page. Legacy tools key their retirement on that
marker (EvilEye's portal guard).

## External interfaces

CLI with `--repo` and bounded `--json` (no MCP). Git pre-push hook via the managed template's opt-in
Docket callback. EvilEye integration (importer, legacy-writer retirement, documentation-checker
adapter) is listed in `PLAN.md` section 2.
