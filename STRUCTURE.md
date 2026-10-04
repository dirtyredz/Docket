# STRUCTURE

Code-shape map for Docket: a Windows 11 CLI (`docket` / `dk`) and local viewer over per-repo Markdown
items. Authority for layout: `docs/PLAN.md` section 2. Status: pre-code, nothing below exists yet except
`docs/`.

Last full review: never (pre-code)

## Dependency direction

```
CLI / viewer  -->  core  -->  storage
importers     -->  core
```

- `core` has no terminal, HTTP or filesystem-path knowledge; it calls `storage` and `repository`.
- `cli` and `viewer` are thin adapters over `core/items` operations; business rules never live in them.
- `importers` read legacy files and write only through `core` (allocation, validation).
- `src/bootstrap/` is quarantined historical code; production code never imports it.

## Layout

- `src/bootstrap/` — recovered merge-test validator and a bootstrap adapter (quarantined, M0 only)
- `src/core/format/` — schema constants, strict parser, canonical serializer
- `src/core/validation/` — item checks, relation graph integrity, warnings, check orchestration
- `src/core/identity/` — random ID allocation, fractional rank, local-date rules
- `src/core/items/` — add, set, link, query: operations shared by CLI and viewer
- `src/storage/` — content revisions, atomic write, lock, item store
- `src/repository/` — worktree and common-dir discovery, `docket.json`, working-tree or Git-tree snapshot
- `src/index/` — rebuildable per-worktree JSON cache and reverse-relation queries
- `src/claims/` — common-dir advisory claims store
- `src/registry/` — per-machine repo registry and document-location overrides
- `src/documents/` — living-doc catalog and read-only Markdown rendering
- `src/cli/` — dispatch, argument handling, output contracts
- `src/cli/commands/` — thin adapters per command family (items, validation, coordination, registry, viewer, migration, gate, conflicts)
- `src/importers/common/` — shared source-map, manifest and resumable apply mechanics
- `src/importers/evileye/` — legacy EvilEye register and shard conversion
- `src/importers/priority-checkbox/` — second legacy shape (priority H2 / checklist)
- `src/integration/` — agent CLAUDE.md/AGENTS.md snippet
- `src/integration/gate/` — gate install, launcher, last-good resolution, pre-push validation
- `src/observability/` — local merge-conflict recording and reporting
- `src/viewer/server/` — server lifecycle, request safety, scoped API routes, worktree overlays
- `src/viewer/ui/` — browser shell and UI modules (board, editor, relations, documents)
- `src/tooling/` — distributable build and layout/size checker
- `tests/` — responsibility-matched suites: format, core, storage, cli, index, claims, registry, importers, integration, viewer, merge, packaging
- `tests/helpers/` — disposable-repo and clock support
- `tests/fixtures/` — bounded fixtures (items, evileye, priority-checkbox)
- `docs/` — living docs and research evidence
- `docs/items/` — Docket's own work items (created in M0; flat, permanent paths)
- `docs/records/` — migration evidence and conflict-review history

## Components

| Component          | Responsibility                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `core/format`      | The only code that reads or writes item frontmatter; body bytes pass through unchanged.  |
| `core/validation`  | The nine ITEM-SPEC check groups; errors fail gates, warnings print.                      |
| `core/identity`    | `dk-<8hex>` allocation with collision retry, LexoRank-style `[a-z]+` ranks, local dates. |
| `core/items`       | Mutations and queries; `add` assigns ID and rank, `set` owns `since`.                    |
| `storage`          | Revision check, temp-write/fsync/rename, per-worktree lock.                              |
| `repository`       | Resolves checkout, `git rev-parse --git-common-dir`, reads a working tree or a Git ref.  |
| `index`            | `.docket/index.json`, rebuilt from source hashes; `check` never trusts it.               |
| `claims`           | `<git-common-dir>/docket-claims.json`, separate lock, expiry on read.                    |
| `registry`         | `%LOCALAPPDATA%/Docket/registry.json`: aliases and paths, no items.                      |
| `integration/gate` | Last-good checker installed outside the checkout; validates pushed refs.                 |
| `viewer`           | Loopback HTTP; every edit calls the same core operations as the CLI.                     |
| `importers`        | Dry-run manifest with byte accounting, then resumable apply.                             |

## Size and placement rules

- Keep code files under about 800 lines; extract by responsibility before crossing it.
- Update this Layout in the same change that adds a new responsibility.

## Structural debt

None yet (pre-code).
