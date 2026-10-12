# STRUCTURE

Code-shape map for Docket: a Windows 11 CLI (`docket` / `dk`) over per-repo Markdown
items (the UI is Command Deck, outside this repo; the viewer was removed in 0.7.0, ADR-29). Authority for layout: `docs/plans/PLAN.md` section 2. Status: M0 to M3b and M6 built (strict core, CLI,
storage, state/index, state/claims, last-good gate, `docket init`, repo registry and scan, facts and notes, managed agent snippet, headless library exports; 0.8.0). Importers were removed in 0.3.0
(ADR-19).

Last full review: 2026-10-05

## Tree

```
src/
  bootstrap/            quarantined recovered validator (not shipped)
  cli/                  main, args, output, report, help (overview + per-command), input
    commands/           one adapter per command family (incl. guide)
      items/            one adapter per item command
  core/                 errors.mjs                  format/ validation/ identity/ items/
    items/content/      body replacement and note lifecycle
  integration/          agent snippet (versioned), init         gate/  promote, smoke, install, launcher, pre-push
  library/              public re-export facades, one per exports subpath (items/ repository/ registry/)
  repository/           checkout facts: context, config, snapshot, paths, canonical, containment, registered-checkout
  state/                claims/  index/  registry/
  storage/              atomic write, lock, item store, revisions
  tooling/              build, layout-check
tests/
  unit/                 format core storage repository state cli
    state/registry/     registry suites (beside claims, index)
  integration/ packaging/ helpers/ fixtures/
docs/                   living docs, LIBRARY.md (shipped contract), items/, plans/ (frozen), records/, research/ (frozen)
```

## Dependency direction

```
CLI  -->  core  -->  repository, storage
CLI  -->  state (index, claims, registry), repository
state, integration  -->  core
library  -->  core, state, repository (re-export only)
state/registry  -->  repository (registered-checkout: identity and availability)
integration/init  -->  repository, storage, integration/gate (install)
```

- `core` has no terminal knowledge. It calls `repository` and `storage`, never `state`: claims
  and the index reach core operations as arguments (`setItem`, `readItem`), so core stays free of the
  coordination stores.
- `cli` is a thin adapter over `core/items` operations; business rules never live in it. Command Deck (external)
  reaches Docket through CLI JSON output and the headless library: `package.json` `exports` names the `library/`
  facades (no root entry, no patterns; contract in `docs/LIBRARY.md`, ADR-30). A facade re-exports only the
  documented names, so implementation modules stay private; change a listed name only with a minor-version bump.
- `integration/gate` validates through core `checkStore`, never through `cli`.
- `core/errors.mjs` is a leaf (no imports) that every layer may use.
- `src/bootstrap/` is quarantined historical code; production code never imports it.

## Layout

- `src/bootstrap/` — recovered merge-test validator and a bootstrap adapter (quarantined; not shipped)
- `src/core/` — the shared error type (`errors.mjs`)
- `src/core/format/` — schema constants, strict parser, canonical serializer, round-trip guard and the content grammar (body/Notes boundaries, note header and ref rules)
- `src/core/validation/` — item checks, relation graph integrity, warnings, check orchestration, `checkStore`
- `src/core/identity/` — random ID allocation, fractional rank, local-date rules
- `src/core/items/` — add, batch add, set (with claim release on completion), complete, link and `linkItem` (with revision maps), query, detail, the relations view, revision preconditions and the shared mutation transaction with its `withWritten` result helper
- `src/core/items/content/` — body replacement and note lifecycle (append, resolve): the content operations behind `set --body-file` and `note`
- `src/storage/` — content revisions, atomic write, lock, item store
- `src/repository/` — worktree and common-dir discovery and explicit-root contexts, `docket.json`, working-tree or Git-tree snapshot, path identity, canonical real paths, containment and the checkout guard, checkout identity and verified opening (`registered-checkout.mjs`)
- `src/library/` — public facades for the headless library (ADR-30, `docs/LIBRARY.md`): one re-export-only module per `package.json` `exports` subpath, naming exactly the documented names (errors, schema, date, claims); no logic
- `src/library/items/` — facades for `docket/items/*` (index, query, detail, relations, set, body, notes, link)
- `src/library/repository/` — facades for `docket/repository/*` (context, canonical, containment, registered-checkout)
- `src/library/registry/` — facades for `docket/registry/*` (paths, source)
- `src/state/claims/` — common-dir advisory claims store
- `src/state/index/` — rebuildable per-worktree JSON cache
- `src/state/registry/` — per-machine repo registry: identity, registration, one-shot scan, the last-good source with forced refresh and strict id lookup (`source.mjs`), document-location overrides (stored, validated metadata only)
- `src/cli/` — dispatch, argument handling, output contracts, shared report vocabulary, help, shared file/stdin input, `docket guide`
- `src/cli/commands/` — thin adapters per command family (items, validation, coordination, init, gate, registry; conflicts planned)
- `src/cli/commands/items/` — one adapter per item command (add, set, link, list, show, index, notes) plus shared item-flag options
- `src/integration/` — the managed, versioned agent snippet (`agent-snippet.mjs`, text in `agent-snippet.md`; markers, exact-legacy migration, manual review) and `docket init` (`init.mjs`)
- `src/integration/gate/` — gate promotion, smoke test, repo opt-in, stable launcher, tarball reader, pre-push validation
- `src/tooling/` — distributable build (tarball contents, export map, removed-dependency guard) and layout/size checker
- `tests/` — suite folders only; unit suites live under `tests/unit/`
- `tests/unit/` — unit suites, one folder per area: format, core, storage, repository, state (claims, index; `registry/` beside them), cli
- `tests/integration/`, `tests/packaging/` — real-push suites and installed-tarball acceptance: CLI (`cli.test.mjs`) and library exports (`library.test.mjs`)
- `tests/helpers/` — disposable-repo, registry/checkout, clock and gate support
- `tests/fixtures/` — bounded fixtures: hooks
- `docs/` — living docs, research evidence and the shipped guides (`MOVE-IN.md`, `AGENT-GUIDE.md`, `LIBRARY.md`)
- `docs/items/` — Docket's own work items (created in M0; flat, permanent paths)
- `docs/records/` — migration evidence and conflict-review history
- `docs/research/` — frozen evidence: item spec, surveys, merge-test results (never reformatted or linted as code)
- `docs/plans/` — frozen build plans (`PLAN.md`, `PLAN-VIEWER.md` (historical), `PLAN-NOTES.md`)

`docs/research/MERGE-TEST-RESULTS.md` is the canonical merge-test result; `docs/research/merge-test/` holds
the raw runs behind it (frozen historical evidence). It is not a code home and is never edited or linted as one.

## Components

| Component          | Responsibility                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `core/errors`      | `docketError`, the code table and exit kinds, `notFound`; the one error shape.                                                          |
| `core/format`      | The only code that reads or writes item frontmatter and the body/Notes grammar; untouched bytes pass through.                           |
| `core/validation`  | The ten ITEM-SPEC check groups; `checkStore` runs them over a checkout or a Git ref.                                                    |
| `core/identity`    | `dk-<8hex>` allocation with collision retry, LexoRank-style `[a-z]+` ranks, local dates.                                                |
| `core/items`       | Mutations (incl. `batch` add, `content/` body and notes), queries and the relations view; `transaction.mjs` is the one lock/write path. |
| `library`          | Re-export-only facades behind the `package.json` `exports` map; name exactly the `docs/LIBRARY.md` names, no logic.                     |
| `storage`          | Revision check, temp-write/fsync/rename, per-worktree lock.                                                                             |
| `repository`       | Checkout, Git common dir, tree or ref reads; canonical real paths, containment; exact-root and registered openers.                      |
| `state/index`      | `.docket/index.json` (v2, open-note count only), rebuilt from source hashes; `check` never trusts it.                                   |
| `state/claims`     | `<git-common-dir>/docket-claims.json`, separate lock, expiry on read.                                                                   |
| `state/registry`   | `registry.json`: ids, aliases, checkout groups by Git common dir, preferred checkout, doc overrides; last-good source.                  |
| `integration/init` | `docket init`: items dir, `docket.json`, ignore entry, agent snippet, optional gate.                                                    |
| `integration/gate` | Promotes tested tarballs to `%LOCALAPPDATA%`; launcher runs `check --ref` per pushed tip.                                               |
| `tooling`          | `build` (npm pack + content and export-map check), `layout-check` (Layout homes, 800-line cap).                                         |

## Size and placement rules

- Keep code files under about 800 lines; extract by responsibility before crossing it.
- Update this Layout in the same change that adds a new responsibility. Keep each level of the tree to
  about ten entries; relieve a full folder by grouping downward, never by adding a sibling.

## Structural debt

- `core/items/link.mjs` may write two files (relates stored on the other side); the writes are each
  atomic but not one transaction. A failure after the first write is reported (`partial`, `written`), not undone.
- `src/core/items/` holds 11 entries (one over the ten-entry guide) since `relations-view.mjs` returned; a
  `relations/` grouping (link + view) is the natural split if it grows again.
- Accepted backlog from the 2026-10-05 reviews is recorded as Docket items (`dk list`, area structure): one
  store-entries shape, unused schema constants, core enum validation, registry/content-format splits. The importer-related items were
  dropped with the importers.
