# STRUCTURE

Code-shape map for Docket: a Windows 11 CLI (`docket` / `dk`) and local viewer over per-repo Markdown
items. Authority for layout: `docs/PLAN.md` section 2. Status: M0 to M1c built (strict core, CLI,
storage, index, claims, last-good gate). Homes for M2+ (importers, registry, documents, viewer,
observability) are declared but empty.

Last full review: never

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

- `src/bootstrap/` — recovered merge-test validator and a bootstrap adapter (quarantined; not shipped)
- `src/core/format/` — schema constants, strict parser, canonical serializer
- `src/core/validation/` — item checks, relation graph integrity, warnings, check orchestration
- `src/core/identity/` — random ID allocation, fractional rank, local-date rules
- `src/core/items/` — add, set, link, query and the shared mutation transaction (CLI and viewer)
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
- `src/integration/gate/` — gate install and promotion, stable launcher, tarball reader, pre-push validation
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

| Component          | Responsibility                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `core/format`      | The only code that reads or writes item frontmatter; body bytes pass through unchanged.   |
| `core/validation`  | The nine ITEM-SPEC check groups; errors fail gates, warnings print.                       |
| `core/identity`    | `dk-<8hex>` allocation with collision retry, LexoRank-style `[a-z]+` ranks, local dates.  |
| `core/items`       | Mutations and queries; `transaction.mjs` is the one lock/validate/write path.             |
| `storage`          | Revision check, temp-write/fsync/rename, per-worktree lock.                               |
| `repository`       | Resolves checkout, `git rev-parse --git-common-dir`, reads a working tree or a Git ref.   |
| `index`            | `.docket/index.json`, rebuilt from source hashes; `check` never trusts it.                |
| `claims`           | `<git-common-dir>/docket-claims.json`, separate lock, expiry on read.                     |
| `registry`         | `%LOCALAPPDATA%/Docket/registry.json`: aliases and paths, no items.                       |
| `integration/gate` | Promotes tested tarballs to `%LOCALAPPDATA%`; launcher runs `check --ref` per pushed tip. |
| `tooling`          | `build` (npm pack + content check), `layout-check` (Layout homes, 800-line cap).          |
| `viewer`           | Loopback HTTP; every edit calls the same core operations as the CLI.                      |
| `importers`        | Dry-run manifest with byte accounting, then resumable apply.                              |

## Size and placement rules

- Keep code files under about 800 lines; extract by responsibility before crossing it.
- Update this Layout in the same change that adds a new responsibility.

## Structural debt

- `src/integration/gate/pre-push.mjs` imports `cli/main.mjs` to run `check --ref` exactly as the CLI
  does (an adapter calling an adapter). Accepted: the gate must validate through the shipped command.
- `core/items/link.mjs` may write two files (relates stored on the other side); the writes are each
  atomic but not one transaction.
