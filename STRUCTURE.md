# STRUCTURE

Code-shape map for Docket: a Windows 11 CLI (`docket` / `dk`) and local viewer over per-repo Markdown
items. Authority for layout: `docs/PLAN.md` section 2. Status: M0 to M4d built (strict core, CLI,
storage, state/index, state/claims, last-good gate, `docket init`, repo registry and scan, local viewer; 0.5.0). Importers were removed in 0.3.0
(ADR-19).

Last full review: 2026-10-05

## Tree

```
src/
  bootstrap/            quarantined recovered validator (not shipped)
  cli/                  main, args, output, report, help (overview + per-command)        commands/  one adapter per command family
  core/                 errors.mjs                  format/ validation/ identity/ items/
  integration/          agent snippet, init         gate/  promote, smoke, install, launcher, pre-push
  repository/           checkout facts: context, config, snapshot, paths, canonical, containment, worktrees
  state/                claims/  index/  registry/     observability/ (planned)
  storage/              atomic write, lock, item store, revisions
  tooling/              build, layout-check
  viewer/               server/ (routes/)   ui/ (views/)   documents/
tests/                  one suite folder per responsibility; helpers/ fixtures/
docs/                   living docs, items/, records/, research/ (historical)
```

## Dependency direction

```
CLI  -->  core  -->  repository, storage
viewer  -->  core, state (index, claims, registry), repository
state, integration  -->  core
integration/init  -->  repository, storage, integration/gate (install)
```

- `core` has no terminal or HTTP knowledge. It calls `repository` and `storage`, never `state`: claims
  and the index reach core operations as arguments (`setItem`, `readItem`), so core stays free of the
  coordination stores.
- `cli` and `viewer` are thin adapters over `core/items` operations; business rules never live in them.
  Viewer edits go through `setItem` and `planLink`; `core/items/revisions.mjs` holds the shared expected-revision assertions.
- Markdown deps (`marked`, `sanitize-html`) are reached only by the dynamic import in `docket serve`; the CLI and gate never load them.
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
- `src/repository/` — worktree and common-dir discovery, `docket.json`, working-tree or Git-tree snapshot, path identity, canonical real paths, containment, worktree listing
- `src/state/claims/` — common-dir advisory claims store
- `src/state/index/` — rebuildable per-worktree JSON cache
- `src/state/registry/` — per-machine repo registry: identity, registration, one-shot scan, document-location overrides
- `src/state/observability/` — local merge-conflict recording and reporting (planned, M3+)
- `src/cli/` — dispatch, argument handling, output contracts, shared report vocabulary, help
- `src/cli/commands/` — thin adapters per command family (items, validation, coordination, init, gate, registry, viewer; conflicts planned)
- `src/integration/` — agent CLAUDE.md/AGENTS.md snippet and `docket init` (`init.mjs`)
- `src/integration/gate/` — gate promotion, smoke test, repo opt-in, stable launcher, tarball reader, pre-push validation
- `src/viewer/server/` — server lifecycle, request safety (boundary), registered-checkout scope, static assets, transient catalog, worktree hints
- `src/viewer/server/routes/` — scoped HTTP adapters: repos, items, relations, documents, search
- `src/viewer/ui/` — browser shell, HTTP client, DOM helper, session drafts, styles
- `src/viewer/ui/views/` — one module per view: repo picker, overview, board, item editor, relations, documents, search, worktree hints
- `src/viewer/documents/` — living-doc catalog and read-only Markdown rendering
- `src/tooling/` — distributable build and layout/size checker
- `tests/` — responsibility-matched suites: format, core, storage, cli, state, registry, viewer, e2e, integration, packaging
- `tests/helpers/` — disposable-repo, clock and gate support
- `tests/fixtures/` — bounded fixtures: hooks
- `docs/` — living docs and research evidence
- `docs/items/` — Docket's own work items (created in M0; flat, permanent paths)
- `docs/records/` — migration evidence and conflict-review history

`docs/research/MERGE-TEST-RESULTS.md` is the canonical merge-test result; `docs/research/merge-test/` holds
the raw runs behind it (frozen historical evidence). It is not a code home and is never edited or linted as one.

## Components

| Component          | Responsibility                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `core/errors`      | `docketError`, the code table and exit kinds, `notFound`; the one error shape.                                      |
| `core/format`      | The only code that reads or writes item frontmatter; body bytes pass through unchanged.                             |
| `core/validation`  | The nine ITEM-SPEC check groups; `checkStore` runs them over a checkout or a Git ref.                               |
| `core/identity`    | `dk-<8hex>` allocation with collision retry, LexoRank-style `[a-z]+` ranks, local dates.                            |
| `core/items`       | Mutations (incl. `batch` add) and queries; `transaction.mjs` is the one lock/write path.                            |
| `storage`          | Revision check, temp-write/fsync/rename, per-worktree lock.                                                         |
| `repository`       | Checkout, Git common dir, tree or ref reads; canonical real paths, containment, worktrees.                          |
| `state/index`      | `.docket/index.json`, rebuilt from source hashes; `check` never trusts it.                                          |
| `state/claims`     | `<git-common-dir>/docket-claims.json`, separate lock, expiry on read.                                               |
| `state/registry`   | `registry.json`: ids, aliases, checkout groups by Git common dir, preferred checkout, doc overrides; locked atomic. |
| `integration/init` | `docket init`: items dir, `docket.json`, ignore entry, agent snippet, optional gate.                                |
| `integration/gate` | Promotes tested tarballs to `%LOCALAPPDATA%`; launcher runs `check --ref` per pushed tip.                           |
| `tooling`          | `build` (npm pack + content check), `layout-check` (Layout homes, 800-line cap).                                    |
| `viewer`           | Loopback server, boundary, scope, catalog, routes, sanitized docs; edits via `setItem`/`planLink`.                  |

## Size and placement rules

- Keep code files under about 800 lines; extract by responsibility before crossing it.
- Update this Layout in the same change that adds a new responsibility. Keep each level of the tree to
  about ten entries; relieve a full folder by grouping downward, never by adding a sibling.

## Structural debt

- `tests/` now has 13 suite folders (registry, viewer, e2e added per PLAN-VIEWER); grouping stays the open item `Group tests/ suites`.
- `core/items/link.mjs` may write two files (relates stored on the other side); the writes are each
  atomic but not one transaction.
- Accepted backlog from the 2026-10-05 review is recorded as Docket items (`dk list`): one store-entries
  shape, unused schema constants, core enum validation, `tests/` grouping. The importer-related items were
  dropped with the importers.
