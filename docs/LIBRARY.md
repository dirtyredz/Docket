# Docket library contract (0.8.0)

Installing the Docket tarball also gives Node programs a small, supported, headless import surface: the same
operations the CLI runs, so a consumer (Command Deck first) reuses Docket's locking, validation, claims, registry
and revision rules instead of re-implementing them. Docket renders nothing: Markdown, HTML sanitizing,
authentication, caching and presentation belong to the consumer.

There is no root entry and no catch-all. Only the subpaths below resolve (`import "docket"` and deep
`docket/src/...` imports fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`), and only the names listed are supported:
other names those modules happen to export are internal and may change in any release. While Docket is 0.x, a
breaking change to a listed name bumps the minor version; pin the tarball. Every operation is synchronous (file
scans, locks, Git subprocesses): call them off any latency-sensitive thread.

## Exports

| Subpath                                 | Supported names                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `docket/package.json`                   | `version` (import with `{ with: { type: "json" } }`)                                                                      |
| `docket/errors`                         | `CODES`, `KIND_OF_CODE`                                                                                                   |
| `docket/schema`                         | `ENUMS`, `ID_RE`, `RELATION_KEYS`, `CLOSED_STATUSES`                                                                      |
| `docket/date`                           | `localDate(now?)` → `YYYY-MM-DD` (local)                                                                                  |
| `docket/items/index`                    | `loadIndex(ctx, {rebuild?})` → `{records, stats}`                                                                         |
| `docket/items/query`                    | `listItems(records, filters?)` → `{items, invalid}`, `compareItems`, `countBy`, `COUNT_FIELDS`                            |
| `docket/items/detail`                   | `readItem(ctx, id, {records, claims})` → `{data, content}`                                                                |
| `docket/items/relations`                | `relationsView(ctx, id, {records, claims, detail?})`                                                                      |
| `docket/items/set`                      | `setItem(ctx, id, changes, {today, expect?, claims})` → `{data, warnings}`                                                |
| `docket/items/body`                     | `replaceBody(ctx, id, body, {expect})` → `{id, noop, revision}`                                                           |
| `docket/items/notes`                    | `addNote(ctx, id, {text, author}, {expect?})`, `resolveNote(ctx, id, ref, {expect?})`                                     |
| `docket/items/link`                     | `linkItem(ctx, id, change, {expect?, expectRevisions?})`                                                                  |
| `docket/claims`                         | `readClaims(commonDir)`, `releaseItem` (pass the module namespace as `claims`)                                            |
| `docket/repository/context`             | `contextFor(root, commonDir, gitDir?)`, `contextAtRoot(root)`                                                             |
| `docket/repository/canonical`           | `canonicalPath(p)`, `pathKey(p)`, `sameKey(a, b)`                                                                         |
| `docket/repository/containment`         | `assertSafeCheckout(ctx)`                                                                                                 |
| `docket/repository/registered-checkout` | `inspectCheckout(p)`, `unavailableReason(repo, checkout)`, `openCheckoutAt(root)`, `createCheckoutOpener({now?, ttlMs?})` |
| `docket/registry/paths`                 | `registryPath(env)`                                                                                                       |
| `docket/registry/source`                | `createRegistrySource(file)`, `findCheckout(registry, repoId, checkoutId?)`                                               |

## Checkouts and scope

Every item operation takes a checkout context `ctx` (`{root, commonDir, itemsDir, docketDir, configPath}`).
Both openers return exactly that shape; `contextAtRoot` and `contextFor(..., gitDir)` add an optional `gitDir`
that no operation reads. Never build one from an unverified path; use one of the two openers.

- **A known folder (not registered):** `openCheckoutAt(root)` accepts only an exact Git checkout root (no
  ancestor discovery: a subdirectory is `DOCKET_NOT_A_REPO`) with a supported `docket.json`, runs the
  containment guard and returns `ctx` with canonical paths. It never initializes or registers anything.
  `contextAtRoot(root)` is the same root check without the `docket.json` and containment checks.
- **The registry:** `createRegistrySource(registryPath(process.env))` is a long-lived source;
  `get({refresh?})` returns `{registry, error, missing}`. It re-reads when the file's size or mtime changes,
  and always on `{refresh: true}` (a manual Refresh). A broken file keeps serving the last good registry with
  `error: {code, message}`; `missing` means no registry file (an empty registry). `findCheckout(registry,
repoId, checkoutId?)` resolves registry ids (default: the preferred checkout). Malformed ids are
  `DOCKET_USAGE`; an unknown repo, or a checkout that is not that repo's, is `DOCKET_NOT_FOUND`, never
  another checkout. Linked worktrees share one repo (grouped by Git common dir); independent clones are
  separate repos.
- **Opening a registered checkout:** keep one `openCheckout = createCheckoutOpener()` per process.
  `openCheckout(repo, checkout, {fresh?})` verifies the registration against Git (the path is still a
  checkout root with a supported `docket.json` and still belongs to the registered common dir). A read may
  reuse a verification younger than 5 s made for the same repo id, checkout id, path and common dir; pass
  `{fresh: true}` before every mutation. An unavailable checkout throws `DOCKET_NOT_FOUND` with
  `details: {repo, checkout, unavailable}` (the reason). A failed preferred checkout is never replaced by
  another; the caller may offer the others explicitly. `unavailableReason(repo, checkout)` gives the
  reason (or null) without opening, for inventory views.
- **Containment:** both openers run `assertSafeCheckout(ctx)` on every call: `docket.json`, `.docket/`
  and the items directory must not be links or junctions and must resolve inside the checkout (a linked
  `docs/` is caught too), and no item entry may be a link. Violations are `DOCKET_USAGE` with
  `details: {path}`.
- `inspectCheckout(p)` reports `{root, commonDir, main}` (canonical) and may return an ancestor root of
  `p` (the registry's `repo add` behaviour); compare with `sameKey` if you use it directly.

## Reads

- `loadIndex(ctx)` → `{records, stats}`: one summary record per item file (`{name, id, fields, title,
errors, openNoteCount, revision}`), refreshed from the files (the `.docket/index.json` cache is
  disposable). Malformed files are records with `errors`, never dropped.
- `listItems(records, filters)` → `{items, invalid}`: every matching valid item, uncapped (the CLI's
  500-row limit is the CLI's), ordered by priority, bytewise rank, then ID. `filters`: `{status[], type[],
priority[], area, parent, blocked, all, notes: "open"}`; without `all` or `status`, done and dropped
  items are hidden. `invalid` lists malformed files. `countBy(items, field)` counts every enum value of
  `status`, `type` or `priority` (zeros included).
- `readItem(ctx, id, {records, claims})` → `{data, content}` parses the item from one fresh read, so
  fields, title, body, notes, errors and `revision` describe the same bytes; `records` supply only the
  surrounding items (reverse relations, blocker statuses). `data.bodySource` is the exact editable facts
  text; `data.notes` the parsed notes; `data.notesMalformed`/`notesSource` keep a broken Notes section out
  of the facts. A missing file is `DOCKET_NOT_FOUND`.
- `relationsView(ctx, id, {records, claims, detail?})` → `{id, type, revision, forward: {parent, fixes,
blocked_by, relates}, reverse: {children, fixedBy, blocks, relates}, reverseStored, related, revisions}`.
  Pass the `data` from `readItem` as `detail` so the view describes exactly the displayed bytes (no second
  read). `related[id].state` is `ok`, `missing` or `malformed`. `revisions` holds the selected item at that
  revision plus each reverse-stored `relates` holder (an item whose file stores the edge, which a removal
  rewrites) at the revision of the record that showed it; other referenced targets are deliberately absent.

## Mutations and revisions

`revision` is a hash of an item file's exact bytes. Each mutation takes the item lock, re-reads every item,
checks preconditions, validates the result (a change that would introduce a validation error is
`DOCKET_INVALID`), then writes atomically. `expect` is checked inside the lock before planning, so a stale
caller is refused even when its change would be a no-op. `expect` is required by `replaceBody` and optional
elsewhere (omitting it skips the check: a UI should always send it).

- `setItem(ctx, id, changes, {today: localDate(), expect, claims})`, `changes`: `{status?, priority?,
title?, type?, area?, placement?}` (`title` rewrites only the H1) → `{data: {id, changed, fields, completed,
revision, noop, claimReleased?}, warnings}`. Completing an item releases its claim; a failed release is
  a warning, never a failed save.
- `replaceBody(ctx, id, body, {expect})` replaces exactly the facts text after the H1 → `{id, noop,
revision}`.
- `addNote(ctx, id, {text, author}, {expect})` → `{id, ref, author, state: "open", noop, revision}`.
  `author` is `owner` or `agent` (default `owner`; set it explicitly). `resolveNote(ctx, id, ref, {expect})`
  → `{id, ref, state, noop, revision}`. Resolving copies nothing into the facts.
- `linkItem(ctx, id, change, {expect?, expectRevisions?})`, `change`: `{parent?, clearParent?, remove?,
fixes?, blocked_by?, relates?}` (lists of target ids) → `{id, changes, fields, written: [{id,
revision}]}`. With `expectRevisions` (send `relationsView(...).revisions`): the map must hold the
  selected item (agreeing with `expect` if both are sent), which is checked even for a no-op, and every
  other file the edit actually rewrites (a reverse-stored `relates` removal). A missing or malformed entry
  is `DOCKET_USAGE`, a stale one `DOCKET_CONFLICT`, and every check runs before the first write. Entries
  for files the edit does not rewrite are ignored. Without the map (the CLI), holders are written at the
  revision just read inside the lock.
- **Partial writes.** A relation edit that rewrites two files writes each atomically, not both as one
  transaction. If a later write fails after an earlier one landed, the error is rethrown with
  `partial: true` and `written` (the files already replaced): treat the outcome as uncertain and re-read
  every involved item.
- Docket locks only cooperating Docket writers: an external editor can still save between the check and
  the rename. The revision check narrows that race; it does not close it.

## Errors

Failures are `Error`s with a stable `code` (a `CODES` value) and optional `details`. `KIND_OF_CODE` maps each
code to `usage`, `conflict`, `notFound`, `failed` or `internal`.

| Code                | Meaning                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `DOCKET_CONFLICT`   | stale `expect` or revision-map entry; `details: {id, expected, actual}`                                    |
| `DOCKET_LOCKED`     | another writer holds the item lock                                                                         |
| `DOCKET_NOT_FOUND`  | item, note, registered repo or checkout; an unavailable checkout (`details.unavailable`)                   |
| `DOCKET_INVALID`    | a malformed item that must be fixed by hand, a change that would add a validation error, a broken registry |
| `DOCKET_USAGE`      | bad input: ids, refs, missing `expect` or map entries, unsafe (linked or escaping) item storage            |
| `DOCKET_NOT_A_REPO` | not a Git checkout, or not exactly a checkout root                                                         |
| `DOCKET_GIT`        | a Git subprocess failed                                                                                    |
