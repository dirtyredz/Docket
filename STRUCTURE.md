# STRUCTURE

Code-shape map for Docket: a Windows 11 CLI (`docket` / `dk`) and local viewer over per-repo Markdown
items. Authority for layout: `docs/PLAN.md` section 2. Status: M0 to M3-init built (strict core, CLI,
storage, state/index, state/claims, last-good gate, `docket init`). Importers were removed in 0.3.0
(ADR-19). Homes marked "(planned, M3+)" are declared but empty.

Last full review: 2026-10-05

## Tree

```
src/
  bootstrap/            quarantined recovered validator (not shipped)
  cli/                  main, args, output, help         commands/  one adapter per command family
  core/                 errors.mjs                  format/ validation/ identity/ items/
  integration/          agent snippet, init         gate/  promote, smoke, install, launcher, pre-push
  repository/           checkout facts: context, config, snapshot, paths
  state/                claims/  index/             registry/ observability/ (planned, M3+)
  storage/              atomic write, lock, item store, revisions
  tooling/              build, layout-check
  viewer/               server/ ui/ documents/ (all planned, M3+)
tests/                  one suite folder per responsibility; helpers/ fixtures/
docs/                   living docs, items/, records/, research/ (historical)
```

## Dependency direction

```
CLI / viewer  -->  core  -->  repository, storage
state, integration  -->  core
integration/init  -->  repository, storage, integration/gate (install)
```

- `core` has no terminal or HTTP knowledge. It calls `repository` and `storage`, never `state`: claims
  and the index reach core operations as arguments (`setItem`, `readItem`), so core stays free of the
  coordination stores.
- `cli` and `viewer` are thin adapters over `core/items` operations; business rules never live in them.
- `integration/gate` validates through core `checkStore`, never through `cli`.
- `core/errors.mjs` is a leaf (no imports) that every layer may use.
- `src/bootstrap/` is quarantined historical code; production code never imports it.

## Layout

- `src/bootstrap/` — recovered merge-test validator and a bootstrap adapter (quarantined; not shipped)
- `src/core/` — the shared error type (`errors.mjs`)
- `src/core/format/` — schema constants, strict parser, canonical serializer and round-trip guard
- `src/core/validation/` — item checks, relation graph integrity, warnings, check orchestration, `checkStore`
- `src/core/identity/` — random ID allocation, fractional rank, local-date rules
- `src/core/items/` — add, batch add, set (with claim release on completion), link, query, detail and the shared mutation transaction (CLI and viewer)
- `src/storage/` — content revisions, atomic write, lock, item store
- `src/repository/` — worktree and common-dir discovery, `docket.json`, working-tree or Git-tree snapshot, path identity
- `src/state/claims/` — common-dir advisory claims store
- `src/state/index/` — rebuildable per-worktree JSON cache
- `src/state/registry/` — per-machine repo registry and document-location overrides (planned, M3+)
- `src/state/observability/` — local merge-conflict recording and reporting (planned, M3+)
- `src/cli/` — dispatch, argument handling, output contracts
- `src/cli/commands/` — thin adapters per command family (items, validation, coordination, init, gate; registry, viewer, conflicts planned)
- `src/integration/` — agent CLAUDE.md/AGENTS.md snippet and `docket init` (`init.mjs`)
- `src/integration/gate/` — gate promotion, smoke test, repo opt-in, stable launcher, tarball reader, pre-push validation
- `src/viewer/server/` — server lifecycle, request safety, scoped API routes, worktree overlays (planned, M3+)
- `src/viewer/ui/` — browser shell and UI modules: board, editor, relations (planned, M3+)
- `src/viewer/documents/` — living-doc catalog and read-only Markdown rendering (planned, M3+)
- `src/tooling/` — distributable build and layout/size checker
- `tests/` — responsibility-matched suites: format, core, storage, cli, state, integration, packaging
- `tests/helpers/` — disposable-repo and clock support
- `tests/fixtures/` — bounded fixtures: hooks
- `docs/` — living docs and research evidence
- `docs/items/` — Docket's own work items (created in M0; flat, permanent paths)
- `docs/records/` — migration evidence and conflict-review history

`docs/research/merge-test/` holds frozen historical evidence (the prototype run); it is not a code home
and is never edited or linted as one.

## Components

| Component          | Responsibility                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `core/errors`      | `docketError`, the code table and exit kinds, `notFound`; the one error shape.            |
| `core/format`      | The only code that reads or writes item frontmatter; body bytes pass through unchanged.   |
| `core/validation`  | The nine ITEM-SPEC check groups; `checkStore` runs them over a checkout or a Git ref.     |
| `core/identity`    | `dk-<8hex>` allocation with collision retry, LexoRank-style `[a-z]+` ranks, local dates.  |
| `core/items`       | Mutations and queries; `transaction.mjs` is the one lock/validate/write path.             |
| `storage`          | Revision check, temp-write/fsync/rename, per-worktree lock.                               |
| `repository`       | Resolves checkout, `git rev-parse --git-common-dir`, reads a working tree or a Git ref.   |
| `state/index`      | `.docket/index.json`, rebuilt from source hashes; `check` never trusts it.                |
| `state/claims`     | `<git-common-dir>/docket-claims.json`, separate lock, expiry on read.                     |
| `state/registry`   | `%LOCALAPPDATA%/Docket/registry.json`: aliases and paths, no items (planned).             |
| `integration/init` | `docket init`: items dir, `docket.json`, ignore entry, agent snippet, optional gate.      |
| `integration/gate` | Promotes tested tarballs to `%LOCALAPPDATA%`; launcher runs `check --ref` per pushed tip. |
| `tooling`          | `build` (npm pack + content check), `layout-check` (Layout homes, 800-line cap).          |
| `viewer`           | Loopback HTTP; every edit calls the same core operations as the CLI (planned).            |

## Size and placement rules

- Keep code files under about 800 lines; extract by responsibility before crossing it.
- Update this Layout in the same change that adds a new responsibility. Keep each level of the tree to
  about ten entries; relieve a full folder by grouping downward, never by adding a sibling.

## Structural debt

- `core/items/link.mjs` may write two files (relates stored on the other side); the writes are each
  atomic but not one transaction.
- Accepted backlog from the 2026-10-05 review is recorded as Docket items (`dk list`): one store-entries
  shape, unused schema constants, core enum validation, `tests/` grouping. The importer-related items were
  dropped with the importers.
