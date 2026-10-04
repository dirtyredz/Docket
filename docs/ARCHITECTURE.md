# ARCHITECTURE

How Docket works. Code map is in `../STRUCTURE.md`; reasons are in `DECISIONS.md`. Status: design
only, no code yet. Authority: `PLAN.md` and `research/ITEM-SPEC.md`.

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

## Viewer checkout targeting

`docket serve` binds loopback and calls the same core operations as the CLI. Reads return revisions.
Editing requires an explicitly selected checkout; observations of other worktrees (claims, branch-local
work) are labeled advisory hints and are never written into the main checkout. Paths are restricted to
registered, contained locations; traversal, foreign origins and unsafe HTML are rejected. Living docs
are rendered read-only; there is no document-write endpoint.

## External interfaces

CLI with `--repo` and bounded `--json` (no MCP). Git pre-push hook via the managed template's opt-in
Docket callback. EvilEye integration (importer, legacy-writer retirement, documentation-checker
adapter) is listed in `PLAN.md` section 2.
